/**
 * Zod dogrulama ara katmani: her unary RPC'yi ayni kapidan gecirir.
 *
 * Bir handler'in yapmasi gereken is uctur ve ucu de burada, TEK YERDE yapilir:
 *   1) gelen mesaji dogrula (ADR-10: dogrulama tek kutuphane, Zod),
 *   2) is mantigini cagir,
 *   3) her hatayi AppError uzerinden gRPC status'una cevir ve gunluge yaz.
 *
 * Her cagri ayrica sayilir ve suresi kaydedilir (T10.5, rpc-metrics.ts) ve
 * bir sunucu span'inin icinde kosar (D15, tracing.ts): ust span gelen
 * traceparent'tan, handler'in gunluk satirlari ve giden cagrilari bu izde.
 * Hatanin gunluk seviyesi kodun agirligindan gelir (#49; @getir/core
 * ERROR_CODE_SEVERITY): beklenen is sonucu info, siradisi durum (bagimli
 * servis yok, yazilmamis uc) warn, beklenmeyen ariza error.
 *
 * Boylece `src/interfaces/grpc` altindaki handler'lar proje kuralinin istedigi
 * gibi ~15 satirda kalir: try/catch, dogrulama ve gunlukleme tekrari yok.
 *
 * NEDEN gRPC INTERCEPTOR DEGIL: @grpc/grpc-js'in sunucu tarafi interceptor'lari
 * mesaji COZULMUS halde degil, akis olaylari (onReceiveMessage) uzerinden
 * gorur ve handler'in cagrisini tipli bicimde saramaz. Dogrulama sonucunun
 * TIPLI olarak handler'a girmesini istiyoruz (`z.infer`), bu yuzden sarmalayici
 * fonksiyon yaklasimi secildi; yan etkisi, cagri yerinde ne oldugunun
 * okunabilir kalmasi.
 */

import { ERROR_CODES, ERROR_SEVERITY, errorSeverityFor, isAppError } from '@getir/core';
import type { ErrorSeverity, LogFields } from '@getir/core';
import { status as GrpcStatus } from '@grpc/grpc-js';
import type { handleUnaryCall, sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';

import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import type { HandlerContext } from './context.js';
import { requestIdFrom } from './context.js';
import { parseRequest } from './request.js';
import type { RequestSchema } from './request.js';
import { recordRpc, RPC_OK_CODE } from './rpc-metrics.js';
import { toServiceError } from './status.js';
import { endRpcSpan, runInSpan, startServerSpan } from './tracing.js';

export type { RequestSchema } from './request.js';

/** hrtime nanosaniye doner; gunluge milisaniye, metrige saniye yaziyoruz. */
const NANOSECONDS_PER_MS = 1_000_000;
const MS_PER_SECOND = 1_000;

type FailureLog = (logger: Logger, fields: LogFields, error: unknown) => void;

/**
 * Agirlik -> gunluk satiri (#49). Beklenen is sonucu (stok yok, kupon gecersiz)
 * ariza degildir: info, yigin izi yok. Siradisi durum ve beklenmeyen ariza hatayi
 * (`err`) tasir; ikincisi uyari akisinda kaybolmasin diye error seviyesindedir.
 */
const FAILURE_LOG: Readonly<Record<ErrorSeverity, FailureLog>> = {
  [ERROR_SEVERITY.EXPECTED]: (logger, fields) => {
    logger.info(fields, 'rpc is hatasiyla dondu');
  },
  [ERROR_SEVERITY.UNUSUAL]: (logger, fields, error) => {
    logger.warn({ ...fields, err: error }, 'rpc siradisi hatayla dondu');
  },
  [ERROR_SEVERITY.UNEXPECTED]: (logger, fields, error) => {
    logger.error({ ...fields, err: error }, 'rpc beklenmeyen hatayla dondu');
  },
};

export interface UnaryHandlerOptions<TInput, TResponse> {
  /** RPC adi; yalnizca gunluk alani olarak kullanilir (orn. "ListProducts"). */
  readonly name: string;
  /** Gelen mesajin semasi. Handler dogrulanmis veriyi alir, ham mesaji degil. */
  readonly schema: RequestSchema<TInput>;
  /** Is mantigi. Beklenen hatalar AppError firlatir; gerisi INTERNAL'a duser. */
  readonly handle: (input: TInput, context: HandlerContext) => Promise<TResponse> | TResponse;
  /** Verilmezse hicbir sey yazilmaz (testlerde varsayilan budur). */
  readonly logger?: Logger;
}

/**
 * Bir unary RPC uygulamasini gRPC'nin bekledigi handler'a cevirir.
 *
 * Kullanim:
 *   const listProducts = unaryHandler({
 *     name: 'ListProducts',
 *     schema: listProductsRequestSchema,
 *     handle: (input, ctx) => useCase.execute(input, ctx.requestId),
 *     logger,
 *   });
 */
export function unaryHandler<TInput, TResponse>(
  options: UnaryHandlerOptions<TInput, TResponse>,
): handleUnaryCall<unknown, TResponse> {
  const baseLogger = options.logger ?? silentLogger;

  return (call: ServerUnaryCall<unknown, TResponse>, callback: sendUnaryData<TResponse>): void => {
    const requestId = requestIdFrom(call.metadata);
    const logger = baseLogger.child({ rpc: options.name, requestId });
    const context: HandlerContext = { requestId, metadata: call.metadata, logger };
    const startedAt = process.hrtime.bigint();
    const server = startServerSpan(call.getPath(), call.metadata, requestId);

    void runInSpan(server, async () => {
      try {
        const input = parseRequest(options.schema, call.request, requestId);
        const response = await options.handle(input, context);
        const durationMs = elapsedMs(startedAt);
        recordRpc(options.name, RPC_OK_CODE, durationMs / MS_PER_SECOND);
        endRpcSpan(server.span, GrpcStatus.OK);
        logger.debug({ durationMs }, 'rpc tamamlandi');
        callback(null, response);
      } catch (error: unknown) {
        const serviceError = toServiceError(error, { requestId });
        const code = isAppError(error) ? error.code : ERROR_CODES.INTERNAL;
        const durationMs = elapsedMs(startedAt);
        recordRpc(options.name, code, durationMs / MS_PER_SECOND);

        // AppError olmayan hata beklenmeyendir (INTERNAL'a duser).
        const severity = isAppError(error)
          ? errorSeverityFor(error.code)
          : ERROR_SEVERITY.UNEXPECTED;
        endRpcSpan(server.span, serviceError.code, { errorCode: code, severity, error });
        FAILURE_LOG[severity](logger, { durationMs, code, grpcStatus: serviceError.code }, error);
        callback(serviceError, null);
      }
    });
  };
}

/** hrtime araligini milisaniyeye cevirir (gunluk alani: durationMs). */
function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / NANOSECONDS_PER_MS;
}
