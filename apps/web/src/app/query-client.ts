import { AppError, ERROR_CODES } from '@getir/core';
import { QueryClient } from '@tanstack/react-query';

import { MAX_QUERY_RETRIES } from '../shared/config/constants';

/**
 * Yalnizca GECICI hata yeniden denenir (ag kopmasi, gateway 503). Is hatasi
 * (NOT_FOUND, VALIDATION_FAILED) tekrar denense de ayni cevabi verir.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return (
    failureCount < MAX_QUERY_RETRIES &&
    error instanceof AppError &&
    error.code === ERROR_CODES.SERVICE_UNAVAILABLE
  );
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery },
      // Mutasyon otomatik tekrarlanmaz: tekrari kullanici niyeti baslatir (ADR-08).
      mutations: { retry: false },
    },
  });
}
