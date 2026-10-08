import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';

/** Kullaniciya gosterilecek cumle: gateway'in cumlesi (ERROR_MESSAGES) ya da genel hata. */
export const userMessage = (error: unknown): string =>
  error instanceof AppError ? error.message : errorMessage(ERROR_CODES.INTERNAL);
