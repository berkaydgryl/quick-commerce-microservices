import { AppError } from '@getir/core';
import type { ErrorCode } from '@getir/core';

/** Hata, bu kodu tasiyan bir AppError mi (sunucu zarfindan ya da istemciden)? */
export function hasErrorCode(error: unknown, code: ErrorCode): error is AppError {
  return error instanceof AppError && error.code === code;
}
