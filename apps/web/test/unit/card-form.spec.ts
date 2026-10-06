/**
 * Kart ekleme formu (T11.17): kurallar ve cumleler sozlesmeden; son kullanma
 * Ay/Yil secimleriyle (secilmediyse icerigin uyarisi), Turkiye saatiyle
 * gecmemis, en fazla 20 yil ileri; CVV markanin uzunlugunda; kullanim
 * kosullari zorunlu; istek (bos kart adi gonderilmez, ad NFC) ve sunucu
 * hatasinin forma eslenmesi (ayni kart QA C4).
 */

import { CARD_FIELD_MESSAGES, CONTENT_FALLBACK, errorMessage } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  cardFormFeedback,
  cardFormSchema,
  cvvProblem,
  retryWaitSeconds,
  toAddCardRequest,
} from '../../src/features/cards/services/card-form';
import type { CardFormValues } from '../../src/features/cards/services/card-form';

import { AMEX_NUMBER, VISA_NUMBER } from './card-test-support';

const TEXTS = CONTENT_FALLBACK.paymentMethods;
const NOTICES = {
  expiryRequiredNotice: TEXTS.expiryRequiredNotice,
  termsRequiredNotice: TEXTS.termsRequiredNotice,
};
const DUPLICATE = TEXTS.duplicateCardNotice;
const NOW = new Date('2026-10-05T12:00:00.000Z');
const VALID: CardFormValues = {
  nickname: '',
  number: VISA_NUMBER,
  holderName: 'Ayşe Yılmaz',
  expiryMonth: '08',
  expiryYear: '2029',
  cvv: '123',
  terms: true,
};

const issues = (values: CardFormValues) => {
  const result = cardFormSchema(NOTICES, () => NOW).safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
};

describe('card-form (T11.17)', () => {
  it('gecerli form sorun vermez', () => {
    expect(issues(VALID)).toEqual({});
  });

  it('Ay ve Yil secilmediyse icerigin uyarisi; ikisi ayri alan', () => {
    expect(issues({ ...VALID, expiryMonth: '', expiryYear: '' })).toEqual({
      expiryMonth: TEXTS.expiryRequiredNotice,
      expiryYear: TEXTS.expiryRequiredNotice,
    });
    expect(issues({ ...VALID, expiryYear: '' })).toEqual({
      expiryYear: TEXTS.expiryRequiredNotice,
    });
  });

  it('son kullanma: gecmis ay ve 20 yildan ileri sozlesmenin cumlesiyle, dogru alanda', () => {
    expect(issues({ ...VALID, expiryMonth: '09', expiryYear: '2026' })).toEqual({
      expiryMonth: CARD_FIELD_MESSAGES.expired,
    });
    expect(issues({ ...VALID, expiryMonth: '10', expiryYear: '2026' })).toEqual({});
    expect(issues({ ...VALID, expiryMonth: '01', expiryYear: '2047' })).toEqual({
      expiryYear: CARD_FIELD_MESSAGES.expiryYear,
    });
  });

  it('kullanim kosullari kabul edilmeden form gecmez (zorunlu onay)', () => {
    expect(issues({ ...VALID, terms: false })).toEqual({ terms: TEXTS.termsRequiredNotice });
  });

  it('CVV: Visa 3, Amex 4 hane; harf gecmez', () => {
    expect(cvvProblem('123', VISA_NUMBER)).toBeNull();
    expect(cvvProblem('1234', VISA_NUMBER)).toBe(CARD_FIELD_MESSAGES.cvv);
    expect(cvvProblem('1234', AMEX_NUMBER)).toBeNull();
    expect(cvvProblem('123', AMEX_NUMBER)).toBe(CARD_FIELD_MESSAGES.cvv);
    expect(cvvProblem('12a', VISA_NUMBER)).toBe(CARD_FIELD_MESSAGES.cvv);
    expect(issues({ ...VALID, cvv: '12' })).toEqual({ cvv: CARD_FIELD_MESSAGES.cvv });
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

  it('istek: ay ve yil sayi, ad NFC ve kirpik; bos kart adi ve kosul onayi gonderilmez', () => {
    const request = toAddCardRequest({ ...VALID, holderName: ' Şule ', nickname: '  ' });

    expect(request).toEqual({
      number: VISA_NUMBER,
      expiryMonth: 8,
      expiryYear: 2029,
      cvv: '123',
      holderName: 'Şule'.normalize('NFC'),
    });
    expect(request).not.toHaveProperty('terms');
    expect(toAddCardRequest({ ...VALID, nickname: ' Maaş ' }).nickname).toBe('Maaş');
  });

  it('sunucu hatasi: alan cumlesi kendi alanina, alani olmayan (dolu kasa) formun ustune', () => {
    const feedback = cardFormFeedback(
      new AppError(ERROR_CODES.VALIDATION_FAILED, 'x', {
        details: { expiryYear: CARD_FIELD_MESSAGES.expiryYear, cards: CARD_FIELD_MESSAGES.cards },
      }),
      DUPLICATE,
    );

    expect(feedback.fields).toEqual({ expiryYear: CARD_FIELD_MESSAGES.expiryYear });
    expect(feedback.message).toBe(CARD_FIELD_MESSAGES.cards);
  });

  it('ayni kart (CONFLICT + cardId, QA C4): "Bu kart zaten kayitli"', () => {
    const feedback = cardFormFeedback(
      new AppError(ERROR_CODES.CONFLICT, 'x', {
        details: { cardId: 'crd_00000000000000000000000000000001' },
      }),
      DUPLICATE,
    );

    expect(feedback).toEqual({ fields: {}, message: DUPLICATE });
  });

  it('cardId siz CONFLICT ve saglayici reddi sozlugun cumlesiyle ustte', () => {
    expect(cardFormFeedback(new AppError(ERROR_CODES.CONFLICT, 'x'), DUPLICATE).message).toBe(
      errorMessage(ERROR_CODES.CONFLICT),
    );
    expect(
      cardFormFeedback(new AppError(ERROR_CODES.PAYMENT_DECLINED, 'x'), DUPLICATE).message,
    ).toBe(errorMessage(ERROR_CODES.PAYMENT_DECLINED));
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
