/**
 * Zod dogrulama ara katmani: her unary RPC'yi ayni kapidan gecirir.
 *
 * Bir handler'in yapmasi gereken is uctur ve ucu de burada, TEK YERDE yapilir:
 *   1) gelen mesaji dogrula (ADR-10: dogrulama tek kutuphane, Zod),
 *   2) is mantigini cagir,
 *   3) her hatayi AppError uzerinden gRPC status'una cevir ve gunluge yaz.
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

import { AppError, isAppError } from '@getir/core';
import { status as GrpcStatus } from '@grpc/grpc-js';
import type { handleUnaryCall, sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import type { z } from 'zod';

import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import type { HandlerContext } from './context.js';
import { requestIdFrom } from './context.js';
import { toServiceError } from './status.js';

/** hrtime nanosaniye doner; gunluge milisaniye yaziyoruz. */
const NANOSECONDS_PER_MS = 1_000_000;

/** Ham gRPC mesajini alip tipli girdi ureten sema. */
export type RequestSchema<TInput> = z.ZodType<TInput, z.ZodTypeDef, unknown>;

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

    void (async () => {
      try {
        const input = parseRequest(options.schema, call.request, requestId);
        const response = await options.handle(input, context);
        logger.debug({ durationMs: elapsedMs(startedAt) }, 'rpc tamamlandi');
        callback(null, response);
      } catch (error: unknown) {
        const serviceError = toServiceError(error, { requestId });
        const fields = {
          durationMs: elapsedMs(startedAt),
          code: isAppError(error) ? error.code : 'INTERNAL',
          grpcStatus: serviceError.code,
        };

        // Beklenen is hatasi (stok yok, kupon gecersiz) gurultu degildir: warn.
        // Beklenmeyen hata yigin iziyle birlikte error seviyesinde yazilir ki
        // uyari akisinda kaybolmasin.
        if (isAppError(error) && serviceError.code < GrpcStatus.INTERNAL) {
          logger.warn(fields, 'rpc is hatasiyla dondu');
        } else {
          logger.error({ ...fields, err: error }, 'rpc beklenmeyen hatayla dondu');
        }
        callback(serviceError, null);
      }
    })();
  };
}

/** hrtime araligini milisaniyeye cevirir (gunluk alani: durationMs). */
function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / NANOSECONDS_PER_MS;
}

/** Semayi uygular; basarisizsa alan listesini tasiyan bir AppError firlatir. */
function parseRequest<TInput>(
  schema: RequestSchema<TInput>,
  request: unknown,
  requestId: string,
): TInput {
  const result = schema.safeParse(request);
  if (result.success) {
    return result.data;
  }

  // Ayrintiyi string->string tutuyoruz: getir.common.v1.ErrorDetail.metadata
  // ayni bicimde ve gateway bunu REST zarfindaki `error.details` alanina
  // oldugu gibi gecirebiliyor.
  const details: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '(kok)';
    details[field] = issue.message;
  }

  throw AppError.validation('Gecersiz istek', { details, requestId });
}
