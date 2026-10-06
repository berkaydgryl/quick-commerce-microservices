/**
 * Kartin yuzu (T11.17, M7): yazilan numaranin YALNIZCA ilk 4 ve son 4 hanesi
 * gorunur, aradakiler "•", yazilmayanlar "#"; kayitli kartta ilk 4 + son 4.
 * Kisa ad, son kullanma ve kart uzerindeki ad.
 */

import { CONTENT_FALLBACK } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import {
  cardShortName,
  cardSpokenName,
  faceExpiry,
  faceHolderName,
  maskedCardNumber,
  savedCardFace,
  typedCardFace,
} from '../../src/features/cards/services/card-face';
import type { CardFaceGroups } from '../../src/features/cards/services/card-face';

import { AMEX_NUMBER, EXPIRED_AMEX, VISA_CARD, VISA_NUMBER } from './card-test-support';

const LABELS = CONTENT_FALLBACK.paymentMethods.brandLabels;
const text = (groups: CardFaceGroups) =>
  groups.map((group) => group.map((c) => c.char).join('')).join(' ');

describe('card-face (T11.17)', () => {
  it('tam numara: ilk 4 ve son 4 gorunur, ortasi •; tam numara yuzde YOK', () => {
    const face = typedCardFace('4111111111111234', 'VISA');

    expect(text(face)).toBe('4111 •••• •••• 1234');
    expect(text(face)).not.toContain('4111111111111234');
  });

  it('yazarken: yazilmayan yerler #, ortadaki haneler yazildikca •', () => {
    expect(text(typedCardFace('', null))).toBe('#### #### #### ####');
    expect(text(typedCardFace('424242', 'VISA'))).toBe('4242 ••## #### ####');
    expect(typedCardFace('4', 'VISA')[0]?.[0]).toEqual({ char: '4', kind: 'digit' });
  });

  it('Amex 4-6-5 ve son 4 hane', () => {
    expect(text(typedCardFace(AMEX_NUMBER, 'AMEX'))).toBe('3782 •••••• •0005');
  });

  it('kayitli kart: ilk 4 + • + son 4 (Amex 15 hane yeri)', () => {
    expect(text(savedCardFace(VISA_CARD))).toBe('4242 •••• •••• 4242');
    expect(text(savedCardFace(EXPIRED_AMEX))).toBe('3782 •••••• •0005');
  });

  it('liste satirinin numarasi: ilk 4 ve son 4, arasi yildiz (referans getircarsi)', () => {
    expect(maskedCardNumber(VISA_CARD)).toBe('4242 **** **** 4242');
    expect(maskedCardNumber(EXPIRED_AMEX)).toBe('3782 ****** *0005');
  });

  it('kartin yuzundeki son kullanma secimlerden: secilmeyen yer tutucuda kalir', () => {
    expect(faceExpiry('', '', 'AA/YY')).toBe('AA/YY');
    expect(faceExpiry('08', '', 'AA/YY')).toBe('08/YY');
    expect(faceExpiry('', '2029', 'AA/YY')).toBe('AA/29');
    expect(faceExpiry('08', '2029', 'AA/YY')).toBe('08/29');
  });

  it('QA D6: okunan ad markayla ve son dort haneyle, maske yok', () => {
    expect(cardSpokenName(VISA_CARD, LABELS, 'son dört hane')).toBe('Visa, son dört hane 4242');
    expect(cardSpokenName(EXPIRED_AMEX, LABELS, 'son dört hane')).not.toContain('•');
  });

  it('kisa ad ve kart uzerindeki ad', () => {
    expect(cardShortName(VISA_CARD, LABELS)).toBe('Visa •••• 4242');
    expect(cardShortName(EXPIRED_AMEX, LABELS)).toBe('Amex •••• 0005');
    expect(faceHolderName(' ayşe yılmaz ', 'AD SOYAD')).toBe('AYŞE YILMAZ');
    expect(faceHolderName('  ', 'AD SOYAD')).toBe('AD SOYAD');
  });

  it('kart yuzu numaranin kendisini tasimaz (VISA_NUMBER yuzde birlesik gecmez)', () => {
    const joined = typedCardFace(VISA_NUMBER, 'VISA')
      .flat()
      .map((c) => c.char)
      .join('');
    expect(joined).not.toContain(VISA_NUMBER.slice(4, 12));
  });
});
