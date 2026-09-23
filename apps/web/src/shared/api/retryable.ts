/**
 * Kullaniciya "Tekrar dene" sunulmali mi? Is hatalari (kayit yok, gecersiz
 * istek, yetki) tekrar denense de AYNI cevabi verir; dugme orada kullaniciyi
 * yaniltir. Ag kopmasi, 503 ve beklenmeyen hata gecici olabilir.
 *
 * (Otomatik yeniden deneme daha dardir: app/query-client.ts yalnizca
 * SERVICE_UNAVAILABLE'i kendiliginden tekrar eder.)
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { ErrorCode } from '@getir/core';

const FINAL_ERRORS: ReadonlySet<ErrorCode> = new Set([
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.VALIDATION_FAILED,
  ERROR_CODES.UNAUTHORIZED,
  ERROR_CODES.FORBIDDEN,
]);

export function canRetryManually(error: unknown): boolean {
  return !(error instanceof AppError && FINAL_ERRORS.has(error.code));
}
