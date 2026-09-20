import { describe, expect, it } from 'vitest';

import {
  AppError,
  ERROR_CODES,
  GRPC_STATUS,
  HTTP_STATUS,
  isAppError,
  isErrorCode,
  toAppError,
} from '../../src/index.js';

const REQUEST_ID = 'req-1';

describe('AppError', () => {
  it('kod, mesaj, detay ve requestId tasir', () => {
    const error = new AppError(ERROR_CODES.STOCK_INSUFFICIENT, 'Stok yetersiz', {
      details: { sku: 'SKU-1', requested: 3, available: 1 },
      requestId: REQUEST_ID,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe(ERROR_CODES.STOCK_INSUFFICIENT);
    expect(error.message).toBe('Stok yetersiz');
    expect(error.details).toEqual({ sku: 'SKU-1', requested: 3, available: 1 });
    expect(error.requestId).toBe(REQUEST_ID);
  });

  it('cause saklanir ama serilestirilmez', () => {
    const cause = new Error('redis down');
    const error = AppError.internal('Beklenmeyen hata', { cause });

    expect((error as { cause?: unknown }).cause).toBe(cause);
    expect(Object.keys(error.toJSON())).not.toContain('cause');
    expect(JSON.stringify(error)).not.toContain('redis down');
  });

  it('toJSON yigin izini disari sizdirmaz', () => {
    const error = AppError.validation('Gecersiz istek', {
      details: { fields: ['email'] },
      requestId: REQUEST_ID,
    });
    const json = error.toJSON();

    expect(json).toEqual({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: 'Gecersiz istek',
      details: { fields: ['email'] },
      requestId: REQUEST_ID,
    });
    expect(Object.keys(json)).not.toContain('stack');
    expect(JSON.stringify(error)).not.toContain('stack');
  });

  it('toJSON bos alanlari eklemez', () => {
    const json = AppError.notFound('Yok').toJSON();
    expect(json).toEqual({ code: ERROR_CODES.NOT_FOUND, message: 'Yok' });
  });

  it('statik yardimcilar dogru kodu secer', () => {
    expect(AppError.validation().code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(AppError.conflict().code).toBe(ERROR_CODES.CONFLICT);
    expect(AppError.internal().code).toBe(ERROR_CODES.INTERNAL);
    expect(AppError.notFound().code).toBe(ERROR_CODES.NOT_FOUND);
    expect(AppError.unauthorized().code).toBe(ERROR_CODES.UNAUTHORIZED);
  });

  it('protokol karsiliklarini tablodan okur', () => {
    expect(AppError.validation().httpStatus).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(AppError.validation().grpcStatus).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(AppError.unauthorized().httpStatus).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(AppError.unauthorized().grpcStatus).toBe(GRPC_STATUS.UNAUTHENTICATED);

    const rateLimited = new AppError(ERROR_CODES.RATE_LIMITED, 'Cok fazla istek');
    expect(rateLimited.httpStatus).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(rateLimited.grpcStatus).toBe(GRPC_STATUS.RESOURCE_EXHAUSTED);
  });

  it('her hata kodunun HTTP ve gRPC karsiligi vardir', () => {
    for (const code of Object.values(ERROR_CODES)) {
      const error = new AppError(code, code);
      expect(typeof error.httpStatus).toBe('number');
      expect(typeof error.grpcStatus).toBe('number');
      expect(isErrorCode(code)).toBe(true);
    }
    expect(isErrorCode('BILINMEYEN')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
  });

  it('isAppError sadece AppError icin true doner', () => {
    expect(isAppError(AppError.internal())).toBe(true);
    expect(isAppError(new Error('duz hata'))).toBe(false);
    expect(isAppError({ code: ERROR_CODES.INTERNAL })).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it("toAppError bilinmeyen hatayi sarmalar, AppError'i oldugu gibi birakir", () => {
    const original = AppError.conflict('Cakisma');
    expect(toAppError(original)).toBe(original);

    const wrapped = toAppError(new Error('beklenmeyen'));
    expect(wrapped.code).toBe(ERROR_CODES.INTERNAL);
    expect(wrapped.message).not.toContain('beklenmeyen');
  });
});
