import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { canRetryManually } from '../../src/shared/api/retryable';

describe('canRetryManually', () => {
  it('is hatalarinda "Tekrar dene" sunulmaz: ayni cevap doner', () => {
    for (const code of [
      ERROR_CODES.NOT_FOUND,
      ERROR_CODES.VALIDATION_FAILED,
      ERROR_CODES.FORBIDDEN,
    ]) {
      expect(canRetryManually(new AppError(code, 'x'))).toBe(false);
    }
  });

  it('gecici ya da beklenmeyen hatada sunulur', () => {
    expect(canRetryManually(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x'))).toBe(true);
    expect(canRetryManually(new AppError(ERROR_CODES.INTERNAL, 'x'))).toBe(true);
    expect(canRetryManually(new Error('x'))).toBe(true);
  });
});
