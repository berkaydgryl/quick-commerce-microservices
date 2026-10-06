/**
 * Kart ekleme formu (T11.17): kurallar ve cumleler sozlesmeden; son kullanma
 * "AA/YY" (bicim uyarisi icerikten), Turkiye saatiyle gecmemis, en fazla 20
 * yil ileri; CVV markanin uzunlugunda; istek (bos kart adi gonderilmez, ad
 * NFC) ve sunucu hatasinin forma eslenmesi.
 */

import { CARD_FIELD_MESSAGES, CONTENT_FALLBACK, errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  cardFormFeedback,
  cardFormSchema,
  cvvProblem,
  expiryProblem,
  parseExpiry,
  retryWaitSeconds,
  toAddCardRequest,
} from '../../src/features/cards/services/card-form';
import type { CardFormValues } from '../../src/features/cards/services/card-form';

import { AMEX_NUMBER, VISA_NUMBER } from './card-test-support';

const NOTICE = CONTENT_FALLBACK.paymentMethods.expiryFormatNotice;
const NOW = new Date('2026-10-05T12:00:00.000Z');
const VALID: CardFormValues = {
  number: VISA_NUMBER,
  holderName: 'Ayşe Yılmaz',
  expiry: '08/29',
  cvv: '123',
  nickname: '',
};

const issues = (values: CardFormValues) => {
  const result = cardFormSchema(NOTICE, () => NOW).safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
};

describe('card-form (T11.17)', () => {
  it('gecerli form sorun vermez', () => {
    expect(issues(VALID)).toEqual({});
  });

  it('son kullanma: bicim, ay, gecmis, 20 yildan ileri', () => {
    expect(parseExpiry('08/29')).toEqual({ month: 8, year: 2029 });
    expect(parseExpiry('8/29')).toBeNull();
    expect(expiryProblem('08/2', NOW, NOTICE)).toBe(NOTICE);
    expect(expiryProblem('13/29', NOW, NOTICE)).toBe(CARD_FIELD_MESSAGES.expiryMonth);
    expect(expiryProblem('09/26', NOW, NOTICE)).toBe(CARD_FIELD_MESSAGES.expired);
    expect(expiryProblem('10/26', NOW, NOTICE)).toBeNull();
    expect(expiryProblem('01/47', NOW, NOTICE)).toBe(CARD_FIELD_MESSAGES.expiryYear);
  });

  it('CVV: Visa 3, Amex 4 hane; harf gecmez', () => {
    expect(cvvProblem('123', VISA_NUMBER)).toBeNull();
    expect(cvvProblem('1234', VISA_NUMBER)).toBe(CARD_FIELD_MESSAGES.cvv);
    expect(cvvProblem('1234', AMEX_NUMBER)).toBeNull();
    expect(cvvProblem('123', AMEX_NUMBER)).toBe(CARD_FIELD_MESSAGES.cvv);
    expect(cvvProblem('12a', VISA_NUMBER)).toBe(CARD_FIELD_MESSAGES.cvv);
  });

  it('alan cumleleri sozlesmeden: numara, ad, kart adi', () => {
    expect(issues({ ...VALID, number: '4242424242424241' })).toMatchObject({
      number: CARD_FIELD_MESSAGES.number,
    });
    expect(issues({ ...VALID, number: '42424242' })).toMatchObject({
      number: CARD_FIELD_MESSAGES.numberLength,
    });
    expect(issues({ ...VALID, holderName: 'A' })).toMatchObject({
      holderName: CARD_FIELD_MESSAGES.holderName,
    });
    expect(issues({ ...VALID, nickname: '4242 4242 4242 4242' })).toMatchObject({
      nickname: CARD_FIELD_MESSAGES.nicknameDigits,
    });
  });

  it('istek: ay ve yil sayi, ad NFC ve kirpik; bos kart adi gonderilmez', () => {
    expect(toAddCardRequest({ ...VALID, holderName: ' Şule ', nickname: '  ' })).toEqual({
      number: VISA_NUMBER,
      expiryMonth: 8,
      expiryYear: 2029,
      cvv: '123',
      holderName: 'Şule'.normalize('NFC'),
    });
    expect(toAddCardRequest({ ...VALID, nickname: ' Maaş ' }).nickname).toBe('Maaş');
  });

  it('sunucu hatasi: ay ve yil "Son kullanma" alanina, dolu kasa formun ustune', () => {
    const feedback = cardFormFeedback(
      new AppError(ERROR_CODES.VALIDATION_FAILED, 'x', {
        details: { expiryYear: CARD_FIELD_MESSAGES.expiryYear, cards: CARD_FIELD_MESSAGES.cards },
      }),
    );

    expect(feedback.fields).toEqual({ expiry: CARD_FIELD_MESSAGES.expiryYear });
    expect(feedback.message).toBe(CARD_FIELD_MESSAGES.cards);
  });

  it('ayni kart (CONFLICT) ve saglayici reddi sozlugun cumlesiyle ustte', () => {
    expect(cardFormFeedback(new AppError(ERROR_CODES.CONFLICT, 'x')).message).toBe(
      errorMessage(ERROR_CODES.CONFLICT),
    );
    expect(cardFormFeedback(new AppError(ERROR_CODES.PAYMENT_DECLINED, 'x')).message).toBe(
      errorMessage(ERROR_CODES.PAYMENT_DECLINED),
    );
  });

  it('cok fazla deneme (429): kalan saniye ayrintidan; baska hata ya da sure yoksa null', () => {
    expect(
      retryWaitSeconds(
        new AppError(ERROR_CODES.RATE_LIMITED, 'x', { details: { retryAfterSeconds: 299 } }),
      ),
    ).toBe(299);
    expect(retryWaitSeconds(new AppError(ERROR_CODES.RATE_LIMITED, 'x'))).toBeNull();
    expect(retryWaitSeconds(new AppError(ERROR_CODES.PAYMENT_DECLINED, 'x'))).toBeNull();
    expect(retryWaitSeconds(new Error('ag'))).toBeNull();
  });
});
