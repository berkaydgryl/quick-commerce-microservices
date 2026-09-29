import { errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { formFeedback } from '../../src/features/auth/services/server-errors';

const LOGIN = ['phone', 'password'] as const;
const REGISTER = ['fullName', 'phone', 'password'] as const;

const appError = (code: keyof typeof ERROR_CODES, details?: unknown) =>
  new AppError(ERROR_CODES[code], 'sunucu metni', { details });

describe('sunucu hatasi -> form (T8.5)', () => {
  it('dogrulama ayrintisi alanlarin altina gider', () => {
    const error = appError('VALIDATION_FAILED', {
      phone: 'telefon sebebi',
      password: 'sifre sebebi',
    });

    expect(formFeedback(error, LOGIN)).toEqual({
      fields: { phone: 'telefon sebebi', password: 'sifre sebebi' },
      message: null,
    });
  });

  it('formda karsiligi olmayan ayrinti (baslik) formun ustunde genel mesaj olur', () => {
    const error = appError('VALIDATION_FAILED', { 'Idempotency-Key': 'bicimsiz', phone: 'x' });

    expect(formFeedback(error, REGISTER)).toEqual({
      fields: { phone: 'x' },
      message: errorMessage(ERROR_CODES.VALIDATION_FAILED),
    });
  });

  it('okunamayan ayrinti genel dogrulama mesaji olur', () => {
    expect(formFeedback(appError('VALIDATION_FAILED', 'metin'), LOGIN)).toEqual({
      fields: {},
      message: errorMessage(ERROR_CODES.VALIDATION_FAILED),
    });
  });

  it('kayitli numara telefon alaninin altinda, sozlukteki cumleyle', () => {
    expect(formFeedback(appError('PHONE_ALREADY_REGISTERED'), REGISTER)).toEqual({
      fields: { phone: errorMessage(ERROR_CODES.PHONE_ALREADY_REGISTERED) },
      message: null,
    });
  });

  it('yanlis telefon ya da sifre formun ustunde (hangisi oldugu soylenmez)', () => {
    expect(formFeedback(appError('INVALID_CREDENTIALS'), LOGIN)).toEqual({
      fields: {},
      message: errorMessage(ERROR_CODES.INVALID_CREDENTIALS),
    });
  });

  it('hiz siniri kalan saniyeyi soyler', () => {
    const feedback = formFeedback(appError('RATE_LIMITED', { retryAfterSeconds: 42 }), LOGIN);

    expect(feedback.message).toBe(`${errorMessage(ERROR_CODES.RATE_LIMITED)} (42 sn)`);
  });

  it('hiz sinirinda sure yoksa yalnizca sozluk cumlesi', () => {
    expect(formFeedback(appError('RATE_LIMITED'), LOGIN).message).toBe(
      errorMessage(ERROR_CODES.RATE_LIMITED),
    );
  });

  it('mesaj sunucunun metninden degil sozlukten gelir', () => {
    expect(formFeedback(appError('SERVICE_UNAVAILABLE'), LOGIN).message).toBe(
      errorMessage(ERROR_CODES.SERVICE_UNAVAILABLE),
    );
  });

  it('AppError olmayan hata beklenmeyen hata mesaji olur', () => {
    expect(formFeedback(new TypeError('x'), LOGIN)).toEqual({
      fields: {},
      message: errorMessage(ERROR_CODES.INTERNAL),
    });
  });
});
