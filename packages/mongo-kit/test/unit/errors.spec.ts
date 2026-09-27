import { AppError, ERROR_CODES } from '@getir/core';
import { MongoErrorLabel, MongoNetworkError, MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  isDuplicateKeyError,
  retryableTransactionCause,
  toMongoAppError,
} from '../../src/errors.js';

/** Transaction icindeki es zamanli yazim hatasi: surucunun verdigi bicimde. */
function writeConflictError(): MongoServerError {
  const error = new MongoServerError({ message: 'WriteConflict', code: 112 });
  error.addErrorLabel(MongoErrorLabel.TransientTransactionError);
  return error;
}

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

  it('zaten cevrilmis AppError i OLDUGU GIBI birakir (cift ceviri yok)', () => {
    // withTransaction, repository.run()'in cevirdigi hatayi tekrar buraya
    // verir; CONFLICT'in INTERNAL'a donmesi transaction icindeki her hatanin
    // kodunu kaybettirirdi.
    const conflict = toMongoAppError(duplicateKeyError(), { operation: 'insertOne' });

    expect(toMongoAppError(conflict, { operation: 'withTransaction' })).toBe(conflict);
  });
});

describe('isDuplicateKeyError', () => {
  it('yalnizca 11000 icin true doner', () => {
    expect(isDuplicateKeyError(duplicateKeyError())).toBe(true);
    expect(isDuplicateKeyError(new MongoServerError({ message: 'baska', code: 50 }))).toBe(false);
    expect(isDuplicateKeyError(new Error('duplicate'))).toBe(false);
  });
});

describe('transaction yazim cakismasi (T7.3)', () => {
  it('WriteConflict (112) INTERNAL degil CONFLICT: es zamanli degisiklik', () => {
    expect(toMongoAppError(writeConflictError(), { operation: 'withTransaction' })).toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('etiketli asil hatayi bulur: dogrudan ya da run() in sardigi AppError in cause undan', () => {
    const conflict = writeConflictError();

    expect(retryableTransactionCause(conflict)).toBe(conflict);
    expect(retryableTransactionCause(toMongoAppError(conflict))).toBe(conflict);
  });

  it('etiketsiz ya da Mongo disi hata yeniden denenmez', () => {
    expect(retryableTransactionCause(duplicateKeyError())).toBeUndefined();
    expect(retryableTransactionCause(toMongoAppError(duplicateKeyError()))).toBeUndefined();
    expect(retryableTransactionCause(AppError.internal('outbox yazilamadi'))).toBeUndefined();
    expect(retryableTransactionCause(new Error('baska'))).toBeUndefined();
  });
});
