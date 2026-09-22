import { AppError, ERROR_CODES } from '@getir/core';
import { MongoNetworkError, MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { isDuplicateKeyError, toMongoAppError } from '../../src/errors.js';

/** Surucunun benzersiz indeks ihlalinde firlattigi hatanin aynisi. */
function duplicateKeyError(): MongoServerError {
  const error = new MongoServerError({ message: 'E11000 duplicate key error', code: 11000 });
  error.keyPattern = { sku: 1 };
  error.keyValue = { sku: 'SUT-1L' };
  return error;
}

describe('toMongoAppError', () => {
  it('benzersiz indeks ihlalini CONFLICT yapar', () => {
    const error = toMongoAppError(duplicateKeyError(), {
      operation: 'insertOne',
      collection: 'products',
    });

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ERROR_CODES.CONFLICT);
    expect(error.details).toEqual({
      operation: 'insertOne',
      collection: 'products',
      fields: 'sku',
    });
  });

  it('cakisan DEGERI disari vermez, yalnizca alan adini verir', () => {
    // keyValue musteri verisi tasiyabilir (telefon, adres); hata zarfina girmez.
    const error = toMongoAppError(duplicateKeyError());

    expect(JSON.stringify(error.toJSON())).not.toContain('SUT-1L');
  });

  it('ag hatasini SERVICE_UNAVAILABLE yapar', () => {
    const error = toMongoAppError(new MongoNetworkError('connection 1 closed'));

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
  });

  it('bilinmeyen hatayi INTERNAL yapar ve mesajini sizdirmaz', () => {
    const error = toMongoAppError(new Error('auth failed for user admin on db getir'));

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
    expect(error.message).not.toContain('admin');
  });

  it('asil hatayi cause olarak saklar ama serilestirmez', () => {
    const cause = new Error('bozuk');
    const error = toMongoAppError(cause);

    expect((error as { cause?: unknown }).cause).toBe(cause);
    expect(JSON.stringify(error)).not.toContain('bozuk');
  });
});

describe('isDuplicateKeyError', () => {
  it('yalnizca 11000 icin true doner', () => {
    expect(isDuplicateKeyError(duplicateKeyError())).toBe(true);
    expect(isDuplicateKeyError(new MongoServerError({ message: 'baska', code: 50 }))).toBe(false);
    expect(isDuplicateKeyError(new Error('duplicate'))).toBe(false);
  });
});
