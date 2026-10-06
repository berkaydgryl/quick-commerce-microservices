/**
 * Kart formunun girdi bicimleri (T11.17): saf fonksiyonlar. Marka yazarken
 * numaranin basindan taninir (uzunluk beklenmez): rozet, renk, gruplama ve
 * CVV uzunlugu ona gore. Kurallar ve marka uzunluklari sozlesmede
 * (@getir/contracts card-rules.ts); burada yalnizca yazma kolayligi.
 */

import { BRAND_LENGTHS, CARD_NUMBER_MAX_DIGITS, cardBrandOf, cvvLengthOf } from '@getir/contracts';
import type { CardBrand } from '@getir/contracts';

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

/** Markanin en uzun numarasi (sozlesmenin BRAND_LENGTHS'i); marka yoksa 19. */
function maxDigitsOf(brand: CardBrand | null): number {
  return brand === null ? CARD_NUMBER_MAX_DIGITS : Math.max(...BRAND_LENGTHS[brand]);
}

/** Girdiden rakamlar, markanin en uzun numarasina kadar. */
export function cardNumberDigits(input: string): string {
  const digits = input.replace(/\D/g, '');
  return digits.slice(0, maxDigitsOf(typingBrand(digits)));
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

/** CVV: rakamlar, markanin uzunluguna kadar (Amex 4, digerleri 3; marka yoksa 4). */
export function cvvDigits(input: string, brand: CardBrand | null): string {
  return input.replace(/\D/g, '').slice(0, brand === null ? UNKNOWN_BRAND_CVV : cvvLengthOf(brand));
}

/** Numara alaninda bir duzenleme: yeni rakamlar ve imlecin solundaki rakam sayisi. */
export interface CardNumberEdit {
  readonly digits: string;
  readonly caretDigits: number;
}

/**
 * Silinen rakamdan sonra numara: bas degisince marka, dolayisiyla en uzun
 * numara da degisebilir (QA D5: "2721 0…" 19 haneli bilinmeyen marka,
 * 4. hane silinince "2720…" Mastercard, en fazla 16).
 */
function clampedEdit(digits: string, caretDigits: number): CardNumberEdit {
  const clamped = cardNumberDigits(digits);
  return { digits: clamped, caretDigits: Math.min(caretDigits, clamped.length) };
}

/**
 * Bicimli numara alanindaki duzenleme (QA C7). Tarayicinin verdigi ham deger
 * ve imlec, rakamlara cevrilir; imlec "solunda kac rakam var" olarak tasinir
 * ki bicimlendikten sonra ayni yere konsun. Bosluk silindiyse (rakamlar
 * degismedi) silme komsu rakama uygulanir: Backspace soldakini, Delete
 * sagdakini siler.
 */
export function editCardNumber(
  previous: string,
  raw: string,
  caret: number,
  inputType: string | undefined,
): CardNumberEdit {
  const caretDigits = raw.slice(0, caret).replace(/\D/g, '').length;
  const digits = cardNumberDigits(raw);
  if (digits !== previous) {
    return { digits, caretDigits: Math.min(caretDigits, digits.length) };
  }
  if (inputType === 'deleteContentBackward' && caretDigits > 0) {
    return clampedEdit(
      previous.slice(0, caretDigits - 1) + previous.slice(caretDigits),
      caretDigits - 1,
    );
  }
  if (inputType === 'deleteContentForward' && caretDigits < previous.length) {
    return clampedEdit(
      previous.slice(0, caretDigits) + previous.slice(caretDigits + 1),
      caretDigits,
    );
  }
  return { digits, caretDigits };
}

/** Bicimli metinde `count` rakamdan hemen sonraki konum (imlec). */
export function caretAfterDigits(formatted: string, count: number): number {
  if (count <= 0) {
    return 0;
  }
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index] ?? '')) {
      seen += 1;
      if (seen === count) {
        return index + 1;
      }
    }
  }
  return formatted.length;
}
