/**
 * Kart kasasinin KURALLARI (T11.17): marka sozlugu, alan cumleleri ve saf kural
 * fonksiyonlari (Luhn, marka, CVV uzunlugu, son kullanma, ad ve kart adi). Web
 * yazarken rozeti ve hatayi gosterir; kasa (payment) ayni fonksiyonlarla yeniden
 * denetler (karar sunucudadir). Istek ve cevap semalari cards.ts'tedir.
 *
 * DOGRULAMA MESAJLARI DEGERI YANKILAMAZ: hata ayrintisi alan -> cumledir,
 * girilen numara ya da CVV hicbir mesajda gecmez (testli).
 *
 * AYNI KART kullanicinin kasasinda ilk 4 + son 4 hane + son kullanma ile
 * taninir (tam numara saklanmaz). Bu anahtari paylasan iki farkli kart nadirdir;
 * olursa ikincisi CONFLICT alir. Numaranin HMAC'i bilerek tutulmaz (D1): kasa
 * numaranin hicbir turevini saklamaz.
 */

import { z } from 'zod';

import {
  CARD_EXPIRY_MAX_YEARS_AHEAD,
  CARD_EXPIRY_TIME_ZONE,
  CARD_HOLDER_NAME_MAX_LENGTH,
  CARD_HOLDER_NAME_MIN_LENGTH,
  CARD_NICKNAME_MAX_DIGIT_RUN,
  CARD_NICKNAME_MAX_LENGTH,
  CARD_NUMBER_MAX_DIGITS,
  CARD_NUMBER_MIN_DIGITS,
  SAVED_CARDS_MAX,
} from './constants.js';

/**
 * Kart markasi (proto CardBrand); rozetleri istemci cizer (D3). TROY yalnizca
 * 9792 ile taninir: Troy'un 65 araligi Discover ile cakisir, eklenmez (QA B1).
 */
export const cardBrandSchema = z.enum(['VISA', 'MASTERCARD', 'AMEX', 'TROY']);

export type CardBrand = z.infer<typeof cardBrandSchema>;

/**
 * Alan cumleleri: istemciye giden hata ayrintisi. Hicbiri degeri icermez; kasa
 * (payment) ve gateway ayni cumleleri doner.
 */
export const CARD_FIELD_MESSAGES = {
  number: 'Kart numarası geçersiz',
  numberLength: 'Kart numarası eksik ya da fazla haneli',
  brand: 'Bu kart türü desteklenmiyor',
  expiryMonth: 'Son kullanma ayı 1 ile 12 arasında olmalı',
  expiryYear: 'Son kullanma yılı geçersiz',
  expired: 'Kartın son kullanma tarihi geçmiş',
  cvv: 'Güvenlik kodu geçersiz',
  holderName: `Kart üzerindeki ad ${CARD_HOLDER_NAME_MIN_LENGTH}-${CARD_HOLDER_NAME_MAX_LENGTH} harf olmalı`,
  nickname: `Kart adı en fazla ${CARD_NICKNAME_MAX_LENGTH} karakter olabilir`,
  nicknameCharacters: `Kart adında yalnızca harf, rakam, boşluk ve . , ' - olabilir`,
  nicknameDigits: `Kart adında ${CARD_NICKNAME_MAX_DIGIT_RUN + 1} ya da daha fazla rakam yan yana olamaz`,
  // Kart adi duzenlemede (#148) alan hic yoksa: bos metin adi kaldirir, eksik alan kaldirmaz.
  nicknameMissing: 'Kart adı gönderilmedi',
  cards: `En fazla ${SAVED_CARDS_MAX} kart kaydedebilirsin`,
} as const;

/** Numaradaki bosluk ve tireleri atar ("4242 4242-4242 4242" -> "4242424242424242"). */
export function normalizeCardNumber(input: string): string {
  return input.replace(/[\s-]/g, '');
}

/** Luhn (mod 10) denetimi; yalnizca rakamlardan olusan girdi icin anlamli. */
export function isLuhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) {
    return false;
  }
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * Marka basina gecerli uzunluklar. Web yazarken numarayi markanin en uzun
 * haliyle sinirlar (T11.17); kopyasi tutulmaz.
 */
export const BRAND_LENGTHS: Readonly<Record<CardBrand, readonly number[]>> = {
  VISA: [13, 16, 19],
  MASTERCARD: [16],
  AMEX: [15],
  TROY: [16],
};

/**
 * Numaranin markasi (IIN araligindan) ve uzunlugu o markaya uyuyorsa marka;
 * aksi halde null. Yazarken rozet icin de kullanilir (uzunluk denetimi icin
 * `requireLength: false`).
 */
export function cardBrandOf(
  digits: string,
  options: { readonly requireLength?: boolean } = {},
): CardBrand | null {
  const brand = brandByPrefix(digits);
  if (brand === null) {
    return null;
  }
  if (options.requireLength === false) {
    return brand;
  }
  return BRAND_LENGTHS[brand].includes(digits.length) ? brand : null;
}

function brandByPrefix(digits: string): CardBrand | null {
  if (/^4/.test(digits)) {
    return 'VISA';
  }
  if (/^3[47]/.test(digits)) {
    return 'AMEX';
  }
  // Troy yalnizca 9792: 65 araligi Discover ile cakisir, eklenmez (QA B1).
  if (/^9792/.test(digits)) {
    return 'TROY';
  }
  const two = Number(digits.slice(0, 2));
  const four = Number(digits.slice(0, 4));
  if ((two >= 51 && two <= 55) || (digits.length >= 4 && four >= 2221 && four <= 2720)) {
    return 'MASTERCARD';
  }
  return null;
}

/** Guvenlik kodunun hane sayisi: AMEX 4, digerleri 3. */
export function cvvLengthOf(brand: CardBrand): number {
  return brand === 'AMEX' ? 4 : 3;
}

/** Turkiye saatiyle yil ve ay; tarih bicimlendiricisi bir kez kurulur. */
const EXPIRY_CALENDAR = new Intl.DateTimeFormat('en-US', {
  timeZone: CARD_EXPIRY_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
});

function calendarMonthOf(now: Date): { readonly year: number; readonly month: number } {
  const parts = EXPIRY_CALENDAR.formatToParts(now);
  const part = (type: 'year' | 'month'): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return { year: part('year'), month: part('month') };
}

/**
 * Kart, `now`'in ayindan once mi bitti? Son kullanma ayi boyunca kart gecerlidir;
 * ay Turkiye saatiyle hesaplanir (CARD_EXPIRY_TIME_ZONE).
 */
export function isCardExpired(expiryMonth: number, expiryYear: number, now: Date): boolean {
  const current = calendarMonthOf(now);
  return expiryYear < current.year || (expiryYear === current.year && expiryMonth < current.month);
}

/**
 * Son kullanma yili secenekleri (T11.17 web, "Yıl" secimi; QA C9): Turkiye
 * saatiyle bu yil ve CARD_EXPIRY_MAX_YEARS_AHEAD yil ilerisi. Kasanin kabul
 * ettigi aralikla ayni takvimden: ilk ve son secenek cardExpiryProblem'den gecer.
 */
export function cardExpiryYears(now: Date): readonly number[] {
  const { year } = calendarMonthOf(now);
  return Array.from({ length: CARD_EXPIRY_MAX_YEARS_AHEAD + 1 }, (_, index) => year + index);
}

/** Son kullanma sorunu: hangi alanda, hangi cumle. */
export interface CardExpiryProblem {
  readonly field: 'expiryMonth' | 'expiryYear';
  readonly message: string;
}

/**
 * Son kullanma kurali (zamana bagli, bu yuzden semada degil): kart gecmemis ve
 * Turkiye saatiyle bu yildan en fazla CARD_EXPIRY_MAX_YEARS_AHEAD yil ileri.
 * Kasa eklemede denetler; web yazarken ayni fonksiyonla gosterebilir. Sorun
 * yoksa null.
 */
export function cardExpiryProblem(
  expiryMonth: number,
  expiryYear: number,
  now: Date,
): CardExpiryProblem | null {
  if (isCardExpired(expiryMonth, expiryYear, now)) {
    return { field: 'expiryMonth', message: CARD_FIELD_MESSAGES.expired };
  }
  if (expiryYear > calendarMonthOf(now).year + CARD_EXPIRY_MAX_YEARS_AHEAD) {
    return { field: 'expiryYear', message: CARD_FIELD_MESSAGES.expiryYear };
  }
  return null;
}

/**
 * Kart numarasi kurali: rakam, uzunluk, Luhn, bilinen marka ve markanin hane
 * sayisi. Sorun yoksa null. Uzunluk hatasi (12 hane, 18 haneli Visa) uzunluk
 * cumlesini alir, "desteklenmiyor" degil (QA B3).
 */
export function cardNumberProblem(input: string): string | null {
  const digits = normalizeCardNumber(input);
  if (!/^\d+$/.test(digits)) {
    return CARD_FIELD_MESSAGES.number;
  }
  if (digits.length < CARD_NUMBER_MIN_DIGITS || digits.length > CARD_NUMBER_MAX_DIGITS) {
    return CARD_FIELD_MESSAGES.numberLength;
  }
  if (!isLuhnValid(digits)) {
    return CARD_FIELD_MESSAGES.number;
  }
  const brand = cardBrandOf(digits, { requireLength: false });
  if (brand === null) {
    return CARD_FIELD_MESSAGES.brand;
  }
  if (!BRAND_LENGTHS[brand].includes(digits.length)) {
    return CARD_FIELD_MESSAGES.numberLength;
  }
  return null;
}

/**
 * Ad ve kart adi metni: Unicode NFC (ayri yazilan isaret harfle birlesir:
 * "s" + U+0327 -> "ş") ve kirpma. Kurallar normalize edilmis metne uygulanir.
 */
export function normalizeCardText(input: string): string {
  return input.normalize('NFC').trim();
}

/**
 * Kart uzerindeki ad: harf, bosluk, nokta, kesme ve tire. Bicim ve kontrol
 * karakterleri (U+202E gibi) bu yuzden gecmez.
 */
const HOLDER_NAME_PATTERN = /^[\p{L} .'-]+$/u;
const LETTER_PATTERN = /\p{L}/u;

/**
 * Kart uzerindeki ad kurali (normalizeCardText'ten gecmis metin): uzunluk,
 * izinli karakterler ve EN AZ BIR HARF (yalnizca noktalama gecmez, QA B2).
 */
export function cardHolderNameProblem(name: string): string | null {
  if (
    name.length < CARD_HOLDER_NAME_MIN_LENGTH ||
    name.length > CARD_HOLDER_NAME_MAX_LENGTH ||
    !HOLDER_NAME_PATTERN.test(name) ||
    !LETTER_PATTERN.test(name)
  ) {
    return CARD_FIELD_MESSAGES.holderName;
  }
  return null;
}

/**
 * Kart adi: harf, rakam (0-9), bosluk ve . , ' -. Bicim ve kontrol karakterleri
 * (\p{Cf}, \p{Cc}: U+202E yon cevirici, sifir genislikli bosluk, sekme) izinli
 * kumede olmadigi icin gecmez (QA S2).
 */
const NICKNAME_PATTERN = /^[\p{L}0-9 .,'-]*$/u;
/** Rakamlarin arasina girip diziyi bolebilen ayraclar: dizi bunlar atilarak sayilir. */
const NICKNAME_SEPARATORS = /[ .,'-]/g;
const NICKNAME_DIGIT_RUN = new RegExp(`[0-9]{${CARD_NICKNAME_MAX_DIGIT_RUN + 1}}`);

/**
 * Kart adi kurali (normalizeCardText'ten gecmis metin): uzunluk, izinli
 * karakterler ve uzun rakam dizisi ("4242 4242 4242 4242" ya da
 * "4242-4242.4242" kart adinda saklanamaz). Bos metin sorun degildir: kart adi
 * yok demektir. Kasa ayni fonksiyonla denetler.
 */
export function cardNicknameProblem(nickname: string): string | null {
  if (nickname.length > CARD_NICKNAME_MAX_LENGTH) {
    return CARD_FIELD_MESSAGES.nickname;
  }
  if (!NICKNAME_PATTERN.test(nickname)) {
    return CARD_FIELD_MESSAGES.nicknameCharacters;
  }
  if (NICKNAME_DIGIT_RUN.test(nickname.replace(NICKNAME_SEPARATORS, ''))) {
    return CARD_FIELD_MESSAGES.nicknameDigits;
  }
  return null;
}
