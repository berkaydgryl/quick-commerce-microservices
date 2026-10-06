/**
 * Kart formunun girdi bicimleri (T11.17): marka yazarken taninir; numara
 * markanin en uzun haliyle sinirlanir ve gruplanir (Amex 4-6-5); CVV
 * markanin uzunlugunda. Bicimli numarada imlec yerinde kalir, bosluktan
 * sonra Backspace onceki rakami siler (QA C7); silme markayi degistirirse
 * markanin uzunlugu yeniden uygulanir (QA D5).
 */

import { describe, expect, it } from 'vitest';

import {
  caretAfterDigits,
  cardNumberDigits,
  cvvDigits,
  editCardNumber,
  formatCardNumber,
  numberGroupSizes,
  typingBrand,
} from '../../src/features/cards/services/card-input';

import { AMEX_NUMBER, VISA_NUMBER } from './card-test-support';

/** Bicimli alanda bir duzenleme: yeni gorunen deger ve imlec. */
function apply(previous: string, raw: string, caret: number, inputType?: string) {
  const edit = editCardNumber(previous, raw, caret, inputType);
  const formatted = formatCardNumber(edit.digits);
  return { value: formatted, caret: caretAfterDigits(formatted, edit.caretDigits) };
}

describe('card-input (T11.17)', () => {
  it('marka yazarken taninir (uzunluk beklenmez); bos ve bilinmeyen null', () => {
    expect(typingBrand('4')).toBe('VISA');
    expect(typingBrand('37')).toBe('AMEX');
    expect(typingBrand('51')).toBe('MASTERCARD');
    expect(typingBrand('9792')).toBe('TROY');
    expect(typingBrand('')).toBeNull();
    expect(typingBrand('6011')).toBeNull();
  });

  it('numara: yalnizca rakam, markanin en uzun haliyle sinirli (sozlesmenin BRAND_LENGTHS)', () => {
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

  it('CVV: markanin uzunlugu (Amex 4, digerleri 3; marka yoksa 4)', () => {
    expect(cvvDigits('1234', 'VISA')).toBe('123');
    expect(cvvDigits('12345', 'AMEX')).toBe('1234');
    expect(cvvDigits('1a2b3c4d5', null)).toBe('1234');
  });

  it('QA C7: ortaya yazilan rakamdan sonra imlec sona kacmaz', () => {
    // "4242 4242" -> 5. hanenin onune "9": "4242 94242"; imlec 9'dan hemen sonra.
    expect(apply('42424242', '4242 94242', 6)).toEqual({ value: '4242 9424 2', caret: 6 });
  });

  it('QA C7: ortadan silinen rakamdan sonra imlec yerinde kalir', () => {
    // "4242 4242 42" -> 6. hane (2) silindi: "4242 442 42", imlec 4'ten sonra.
    expect(apply('4242424242', '4242 442 42', 6, 'deleteContentBackward')).toEqual({
      value: '4242 4424 2',
      caret: 6,
    });
  });

  it('QA C7: bosluktan sonra Backspace onceki rakami siler (bosluk geri gelmez)', () => {
    // "4242 4242", imlec bosluktan sonra (5); Backspace boslugu siler: "42424242".
    expect(apply('42424242', '42424242', 4, 'deleteContentBackward')).toEqual({
      value: '4244 242',
      caret: 3,
    });
  });

  it('QA C7: bosluktan once Delete sonraki rakami siler', () => {
    expect(apply('42424242', '42424242', 4, 'deleteContentForward')).toEqual({
      value: '4242 242',
      caret: 4,
    });
  });

  it('QA D5: bosluktaki silme markayi degistirirse markanin uzunlugu yeniden uygulanir', () => {
    // "2721" bilinmeyen marka (19 haneye kadar); 4. hane silinince "2720" Mastercard (en fazla 16).
    const edit = editCardNumber(
      '2721099999999999999',
      '27210999 9999 9999 999',
      4,
      'deleteContentBackward',
    );

    expect(typingBrand(edit.digits)).toBe('MASTERCARD');
    expect(edit.digits).toBe('2720999999999999');
    expect(edit.caretDigits).toBe(3);
  });

  it('sona yazmak: imlec sonda; bas tarafta silme yok', () => {
    expect(apply('4242', '42424', 5)).toEqual({ value: '4242 4', caret: 6 });
    expect(apply('4242', '4242', 0, 'deleteContentBackward')).toEqual({
      value: '4242',
      caret: 0,
    });
  });

  it('caretAfterDigits: n. rakamdan hemen sonraki konum; 0 bas, fazlasi son', () => {
    expect(caretAfterDigits('4242 4242', 4)).toBe(4);
    expect(caretAfterDigits('4242 4242', 5)).toBe(6);
    expect(caretAfterDigits('4242 4242', 0)).toBe(0);
    expect(caretAfterDigits('4242', 9)).toBe(4);
  });
});
