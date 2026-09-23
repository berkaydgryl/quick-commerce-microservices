import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { shouldRetryQuery } from '../../src/app/query-client';
import { MAX_QUERY_RETRIES } from '../../src/shared/config/constants';

describe('shouldRetryQuery', () => {
  const unavailable = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x');

  it('gecici hatayi sinira kadar yeniden dener', () => {
    expect(shouldRetryQuery(0, unavailable)).toBe(true);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, unavailable)).toBe(false);
  });

  it('is hatasini ve bilinmeyen hatayi yeniden denemez', () => {
    expect(shouldRetryQuery(0, new AppError(ERROR_CODES.NOT_FOUND, 'x'))).toBe(false);
    expect(shouldRetryQuery(0, new Error('x'))).toBe(false);
  });
});
