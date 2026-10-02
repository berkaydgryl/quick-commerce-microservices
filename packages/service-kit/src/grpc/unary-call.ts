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
 *
 * Her cagri bir istemci span'i acar ve traceparent'i metadata'ya yazar (D15,
 * tracing.ts): karsi servisin span'i bu cagrinin cocugu olur.
 *
 * DAYANIKLILIK (D17), iki isteğe bagli secenek:
 *  - `breaker`: devre aciksa cagri ag'a gitmez, hemen SERVICE_UNAVAILABLE.
 *    Yalnizca "ulasilamaz" sinifi (SERVICE_UNAVAILABLE: baglanti yok, sure
 *    doldu, karsi taraf hizmet veremiyor) hata sayilir; is hatasi servisin
 *    calistigini gosterir.
 *  - `retry`: YALNIZCA idempotent cagrida verilir (anahtarli ya da okuma).
 *    Denemeler cagrinin TEK sure sinirini paylasir: toplam sure `timeoutMs`'i
 *    asmaz, cagiranin zaman butcesi bozulmaz. Yalnizca "ulasilamaz" sinifinda
 *    ve kalan sure yetiyorsa denenir; aralik ustel artar, rastgele kaydirilir.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { AppError, ERROR_CODES } from '@getir/core';
import { Metadata } from '@grpc/grpc-js';
import type { CallOptions, ClientUnaryCall, ServiceError } from '@grpc/grpc-js';

import { REQUEST_ID_METADATA_KEY, RETRY_MIN_REMAINING_MS } from '../config/constants.js';
import type { CircuitBreaker } from './circuit-breaker.js';
import { recordRetry } from './client-metrics.js';
import { fromServiceError } from './status.js';
import { clientTracingInterceptor } from './tracing.js';

/** Uretilen istemcinin 4 parametreli unary metodu (istek, metadata, secenek, geri cagri). */
export type UnaryInvoker<TRequest, TResponse> = (
  request: TRequest,
  metadata: Metadata,
  options: Partial<CallOptions>,
  callback: (error: ServiceError | null, response: TResponse) => void,
) => ClientUnaryCall;

/** Yeniden deneme (D17). Yalnizca idempotent cagrida verilir. */
export interface RetryPolicy {
  /** Ilk denemeden sonra en fazla kac kez daha denenir. */
  readonly maxRetries: number;
  /** Ilk bekleme (ms); her denemede iki katina cikar, ustune rastgele en fazla bu kadar eklenir. */
  readonly baseDelayMs: number;
  /** Bagimli servisin adi: metrik etiketi. */
  readonly target: string;
}

export interface OutgoingCallOptions {
  /** Gelen istegin kimligi; karsi servise aynen gider. */
  readonly requestId: string;
  /** Cagrinin sure siniri (ms); yeniden denemeler dahil TOPLAM sure. */
  readonly timeoutMs: number;
  /** Bagimli servisin devre kesicisi (D17). */
  readonly breaker?: CircuitBreaker;
  /** Yalnizca idempotent cagrida (D17). */
  readonly retry?: RetryPolicy;
}

export async function callUnary<TRequest, TResponse>(
  invoke: UnaryInvoker<TRequest, TResponse>,
  request: TRequest,
  options: OutgoingCallOptions,
): Promise<TResponse> {
  // Sure siniri DUVAR SAATIDIR (tasima kaygisi, is zamani degil): gRPC mutlak
  // bir an bekler; test saati (fixedClock) burada kullanilsaydi cagri daha
  // baslamadan dolmus sayilirdi. Denemeler AYNI ani paylasir.
  const deadline = Date.now() + options.timeoutMs;
  const { breaker, retry } = options;
  for (let attempt = 0; ; attempt += 1) {
    if (breaker !== undefined && !breaker.tryAcquire()) {
      throw new AppError(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        'Bagimli servis gecici olarak devre disi; biraz sonra tekrar deneyin',
      );
    }
    try {
      const response = await invokeOnce(invoke, request, options.requestId, deadline);
      breaker?.recordSuccess();
      return response;
    } catch (error: unknown) {
      const failure = fromServiceError(error);
      const unavailable = failure.code === ERROR_CODES.SERVICE_UNAVAILABLE;
      if (unavailable) {
        breaker?.recordFailure();
      } else {
        breaker?.recordSuccess();
      }
      const wait = retry === undefined ? 0 : backoffMs(retry, attempt);
      const canRetry =
        unavailable &&
        retry !== undefined &&
        attempt < retry.maxRetries &&
        deadline - Date.now() - wait >= RETRY_MIN_REMAINING_MS;
      if (!canRetry) {
        throw failure;
      }
      recordRetry(retry.target);
      await delay(wait);
    }
  }
}

/** Ustel bekleme + rastgele kaydirma: es zamanli istemciler ayni anda yuklenmesin. */
function backoffMs(retry: RetryPolicy, attempt: number): number {
  return retry.baseDelayMs * 2 ** attempt + Math.floor(Math.random() * retry.baseDelayMs);
}

function invokeOnce<TRequest, TResponse>(
  invoke: UnaryInvoker<TRequest, TResponse>,
  request: TRequest,
  requestId: string,
  deadline: number,
): Promise<TResponse> {
  const metadata = new Metadata();
  metadata.set(REQUEST_ID_METADATA_KEY, requestId);
  return new Promise((resolve, reject) => {
    invoke(
      request,
      metadata,
      { deadline, interceptors: [clientTracingInterceptor] },
      (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(response);
      },
    );
  });
}
