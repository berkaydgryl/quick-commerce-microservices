/**
 * Kart formunun girdi bicimleri (T11.17, tasarim B): saf fonksiyonlar. Marka
 * yazarken numaranin basindan taninir (uzunluk beklenmez): rozet, renk,
 * gruplama ve CVV uzunlugu ona gore. Kurallarin kendisi sozlesmede
 * (@getir/contracts cards.ts); burada yalnizca yazma kolayligi.
 */

import { CARD_NUMBER_MAX_DIGITS, cardBrandOf, cvvLengthOf } from '@getir/contracts';
import type { CardBrand } from '@getir/contracts';

/** Markanin en uzun numarasi (sozlesmedeki uzunluklarin en buyugu). */
const MAX_DIGITS: Readonly<Record<CardBrand, number>> = {
  VISA: 19,
  MASTERCARD: 16,
  AMEX: 15,
  TROY: 16,
};

/** Grup boyu: Amex 4-6-5, digerleri 4'erli. */
const AMEX_GROUPS: readonly number[] = [4, 6, 5];
const GROUP_SIZE = 4;
/** Kartin yuzunde en az bu kadar hane yeri cizilir (16 hane, 4 grup). */
const FACE_DIGITS = 16;
/** Marka belli degilken CVV en fazla bu kadar hane alir (Amex olabilir). */
const UNKNOWN_BRAND_CVV = 4;

/** Yazarken marka: numaranin basindan, uzunluk beklenmeden; taninmazsa null. */
export function typingBrand(digits: string): CardBrand | null {
  return digits === '' ? null : cardBrandOf(digits, { requireLength: false });
}

/** Girdiden rakamlar, markanin en uzun numarasina kadar (marka yoksa 19). */
export function cardNumberDigits(input: string): string {
  const digits = input.replace(/\D/g, '');
  const brand = typingBrand(digits);
  return digits.slice(0, brand === null ? CARD_NUMBER_MAX_DIGITS : MAX_DIGITS[brand]);
}

/** Numaranin gruplari: Amex 4-6-5, digerleri 4'erli; en az 16 hanelik yer. */
export function numberGroupSizes(brand: CardBrand | null, length: number): readonly number[] {
  if (brand === 'AMEX') {
    return AMEX_GROUPS;
  }
  const total = Math.max(FACE_DIGITS, length);
  return Array.from({ length: Math.ceil(total / GROUP_SIZE) }, (_, index) =>
    Math.min(GROUP_SIZE, total - index * GROUP_SIZE),
  );
}

/** "4242424242424242" -> "4242 4242 4242 4242"; Amex "3782 822463 10005". */
export function formatCardNumber(digits: string): string {
  const groups: string[] = [];
  let start = 0;
  for (const size of numberGroupSizes(typingBrand(digits), digits.length)) {
    const part = digits.slice(start, start + size);
    if (part === '') {
      break;
    }
    groups.push(part);
    start += size;
  }
  return groups.join(' ');
}

/** Son kullanma girdisi: en fazla 4 rakam, ikinciden sonra "/": "0829" -> "08/29". */
export function formatExpiryInput(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

/** CVV: rakamlar, markanin uzunluguna kadar (Amex 4, digerleri 3; marka yoksa 4). */
export function cvvDigits(input: string, brand: CardBrand | null): string {
  return input.replace(/\D/g, '').slice(0, brand === null ? UNKNOWN_BRAND_CVV : cvvLengthOf(brand));
}
