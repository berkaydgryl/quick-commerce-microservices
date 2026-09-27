/**
 * Servisler arasi unary gRPC cagrisi (ISTEMCI tarafi).
 *
 * Uc kural TEK yerde uygulanir ki her istemci ayni sekilde davransin:
 *  - x-request-id AYNEN iletilir (yeniden uretilmez): bir istek, butun
 *    servislerin gunlugunde tek iz.
 *  - Her cagrinin sure siniri vardir: takilan bagimli servis cagirani da
 *    kilitlememeli.
 *  - Hata AppError'a geri cevrilir (fromServiceError): karsi taraf x-app-error
 *    koyduysa kodu korunur; ulasilamaz ya da sure dolduysa SERVICE_UNAVAILABLE.
 */

import { Metadata } from '@grpc/grpc-js';
import type { CallOptions, ClientUnaryCall, ServiceError } from '@grpc/grpc-js';

import { REQUEST_ID_METADATA_KEY } from '../config/constants.js';
import { fromServiceError } from './status.js';

/** Uretilen istemcinin 4 parametreli unary metodu (istek, metadata, secenek, geri cagri). */
export type UnaryInvoker<TRequest, TResponse> = (
  request: TRequest,
  metadata: Metadata,
  options: Partial<CallOptions>,
  callback: (error: ServiceError | null, response: TResponse) => void,
) => ClientUnaryCall;

export interface OutgoingCallOptions {
  /** Gelen istegin kimligi; karsi servise aynen gider. */
  readonly requestId: string;
  /** Cagrinin sure siniri (ms). */
  readonly timeoutMs: number;
}

export function callUnary<TRequest, TResponse>(
  invoke: UnaryInvoker<TRequest, TResponse>,
  request: TRequest,
  options: OutgoingCallOptions,
): Promise<TResponse> {
  const metadata = new Metadata();
  metadata.set(REQUEST_ID_METADATA_KEY, options.requestId);
  // Sure siniri DUVAR SAATIDIR (tasima kaygisi, is zamani degil): gRPC mutlak
  // bir an bekler; test saati (fixedClock) burada kullanilsaydi cagri daha
  // baslamadan dolmus sayilirdi.
  const deadline = Date.now() + options.timeoutMs;

  return new Promise((resolve, reject) => {
    invoke(request, metadata, { deadline }, (error, response) => {
      if (error !== null) {
        reject(fromServiceError(error));
        return;
      }
      resolve(response);
    });
  });
}
