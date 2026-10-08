import { AppError, ERROR_CODES } from '@getir/core';

/**
 * Takip hatasinin turu (F22; QA K9 B2 ve code-review):
 *   transient - 503 ya da ag (istemci ag kopmasini SERVICE_UNAVAILABLE'a cevirir):
 *               yoklama surer, son cizim kalir, uyari yok;
 *   final     - digerleri: takip yok (404), yetki, gecersiz cevap (sozlesme
 *               kaymasi, INTERNAL). Kendiliginden gecmez: "alinamadi" ve
 *               "Tekrar dene", yoklama durur.
 * shared/api/retryable.ts "Tekrar dene" sunulsun mu sorusunu yanitlar; burada
 * soru farkli (yoklamaya devam mi): INTERNAL de son sayilir.
 */
export type TrackingErrorKind = 'none' | 'transient' | 'final';

export function trackingErrorKind(error: unknown): TrackingErrorKind {
  if (error === null || error === undefined) {
    return 'none';
  }
  return error instanceof AppError && error.code !== ERROR_CODES.SERVICE_UNAVAILABLE
    ? 'final'
    : 'transient';
}
