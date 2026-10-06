/**
 * Kart formunun girdi bicimleri (T11.17): marka yazarken taninir; numara
 * markanin en uzun haliyle sinirlanir ve gruplanir (Amex 4-6-5); son
 * kullanma "AA/YY"; CVV markanin uzunlugunda.
 */

import { describe, expect, it } from 'vitest';

import {
  cardNumberDigits,
  cvvDigits,
  formatCardNumber,
  formatExpiryInput,
  numberGroupSizes,
  typingBrand,
} from '../../src/features/cards/services/card-input';

import { AMEX_NUMBER, VISA_NUMBER } from './card-test-support';

describe('card-input (T11.17)', () => {
  it('marka yazarken taninir (uzunluk beklenmez); bos ve bilinmeyen null', () => {
    expect(typingBrand('4')).toBe('VISA');
    expect(typingBrand('37')).toBe('AMEX');
    expect(typingBrand('51')).toBe('MASTERCARD');
    expect(typingBrand('9792')).toBe('TROY');
    expect(typingBrand('')).toBeNull();
    expect(typingBrand('6011')).toBeNull();
  });

  it('numara: yalnizca rakam, markanin en uzun haliyle sinirli', () => {
    expect(cardNumberDigits('4242 4242-4242 4242 999')).toBe('4242424242424242999');
    expect(cardNumberDigits(`${AMEX_NUMBER}99`)).toBe(AMEX_NUMBER);
    expect(cardNumberDigits('5555 5555 5555 4444 1')).toBe('5555555555554444');
    expect(cardNumberDigits('ab12')).toBe('12');
  });

  it('gruplama: 4erli; Amex 4-6-5; 19 haneli Visa 4-4-4-4-3', () => {
    expect(formatCardNumber(VISA_NUMBER)).toBe('4242 4242 4242 4242');
    expect(formatCardNumber(AMEX_NUMBER)).toBe('3782 822463 10005');
    expect(formatCardNumber('42424')).toBe('4242 4');
    expect(numberGroupSizes('VISA', 19)).toEqual([4, 4, 4, 4, 3]);
    expect(numberGroupSizes(null, 0)).toEqual([4, 4, 4, 4]);
  });

  it('son kullanma: en fazla 4 rakam, ikinciden sonra "/"', () => {
    expect(formatExpiryInput('0')).toBe('0');
    expect(formatExpiryInput('08')).toBe('08');
    expect(formatExpiryInput('082')).toBe('08/2');
    expect(formatExpiryInput('08/2999')).toBe('08/29');
  });

  it('CVV: markanin uzunlugu (Amex 4, digerleri 3; marka yoksa 4)', () => {
    expect(cvvDigits('1234', 'VISA')).toBe('123');
    expect(cvvDigits('12345', 'AMEX')).toBe('1234');
    expect(cvvDigits('1a2b3c4d5', null)).toBe('1234');
  });
});
