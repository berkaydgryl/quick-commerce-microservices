/**
 * Kart kasasi sozlesmesi (T11.17): kart kurallari (Luhn, marka, CVV, son
 * kullanma), ekleme istegi, maskeli cevap ve DEGER YANKILAMAYAN hata mesajlari.
 */

import { describe, expect, it } from 'vitest';

import {
  addCardRequestSchema,
  CARD_FIELD_MESSAGES,
  CARD_NICKNAME_MAX_LENGTH,
  cardBrandOf,
  cardHolderNameProblem,
  cardIdSchema,
  cardNicknameProblem,
  cardNumberProblem,
  cvvLengthOf,
  isCardExpired,
  isLuhnValid,
  normalizeCardNumber,
  normalizeCardText,
  SAVED_CARDS_MAX,
  savedCardListSchema,
  savedCardSchema,
} from '../../src/index.js';

const CARD_ID = 'crd_0123456789abcdef0123456789abcdef';

/** Luhn'dan gecen ornek numaralar (marka basina). */
const NUMBERS = {
  visa: '4242424242424242',
  visa13: '4000000000006',
  visa19: '4000000000000000006',
  mastercard: '5555555555554444',
  mastercard2: '2223000000000007',
  amex: '378282246310005',
  troy: '9792000000000003',
  discover: '6011000000000004',
  /** Troy'un 65 araligi: Discover ile cakisir, Troy sayilmaz (QA B1). */
  troy65: '6500000000000002',
  /** Bilinen marka, yanlis uzunluk (QA B3). */
  visa18: '400000000000000002',
  mastercard19: '5555555555554444000',
  amex16: '3782822463100003',
} as const;

const REQUEST = {
  number: '4242 4242 4242 4242',
  expiryMonth: 12,
  expiryYear: 2031,
  cvv: '123',
  holderName: 'Ayşe Yılmaz',
  nickname: 'Maaş kartım',
};

/** Hata ayrintisi: alan yolu -> mesajlar (gateway'in VALIDATION_FAILED details'i gibi). */
function fieldErrors(input: unknown): Record<string, string[]> {
  const result = addCardRequestSchema.safeParse(input);
  if (result.success) return {};
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.');
    errors[field] = [...(errors[field] ?? []), issue.message];
  }
  return errors;
}

describe('kart kurallari', () => {
  it('Luhn: ornek numaralar gecer, bir hanesi degisen ve rakam disi gecmez', () => {
    for (const number of Object.values(NUMBERS)) {
      expect(isLuhnValid(number), number).toBe(true);
    }
    expect(isLuhnValid('4242424242424241')).toBe(false);
    expect(isLuhnValid('4242-4242')).toBe(false);
    expect(isLuhnValid('')).toBe(false);
  });

  it('marka IIN araligindan ve uzunluktan: Visa 13/16/19, Mastercard 51-55 ve 2221-2720, Amex 34/37 15 hane, Troy 9792', () => {
    expect(cardBrandOf(NUMBERS.visa)).toBe('VISA');
    expect(cardBrandOf(NUMBERS.visa13)).toBe('VISA');
    expect(cardBrandOf(NUMBERS.visa19)).toBe('VISA');
    expect(cardBrandOf(NUMBERS.mastercard)).toBe('MASTERCARD');
    expect(cardBrandOf(NUMBERS.mastercard2)).toBe('MASTERCARD');
    expect(cardBrandOf(NUMBERS.amex)).toBe('AMEX');
    expect(cardBrandOf(NUMBERS.troy)).toBe('TROY');
    expect(cardBrandOf(NUMBERS.discover)).toBeNull();
    expect(cardBrandOf(NUMBERS.troy65)).toBeNull();
    expect(cardBrandOf('2721000000000000')).toBeNull();
    // Uzunluk markaya uymuyorsa marka yok; yazarken rozet icin uzunluk aranmaz.
    expect(cardBrandOf('42424242424242')).toBeNull();
    expect(cardBrandOf('3782', { requireLength: false })).toBe('AMEX');
    expect(cardBrandOf('22', { requireLength: false })).toBeNull();
  });

  it('bosluk ve tire atilir; CVV Amex te 4, digerlerinde 3 hane', () => {
    expect(normalizeCardNumber(' 4242 4242-4242 4242 ')).toBe(NUMBERS.visa);
    expect(cvvLengthOf('AMEX')).toBe(4);
    expect(cvvLengthOf('VISA')).toBe(3);
    expect(cvvLengthOf('TROY')).toBe(3);
  });

  it('son kullanma ayi boyunca kart gecerli; ertesi ay suresi gecmis', () => {
    const now = new Date('2026-10-05T12:00:00Z');

    expect(isCardExpired(10, 2026, now)).toBe(false);
    expect(isCardExpired(9, 2026, now)).toBe(true);
    expect(isCardExpired(1, 2027, now)).toBe(false);
    expect(isCardExpired(12, 2025, now)).toBe(true);
  });

  it('ay Turkiye saatiyle doner: UTC 21.00 Istanbul da ertesi ayin ilk dakikasidir', () => {
    // 30 Eylul 23.59.59 (Istanbul): eylul kartlari hala gecerli.
    expect(isCardExpired(9, 2026, new Date('2026-09-30T20:59:59Z'))).toBe(false);
    // 1 Ekim 00.00 (Istanbul) ama UTC hala 30 Eylul: eylul kartinin suresi gecti.
    expect(isCardExpired(9, 2026, new Date('2026-09-30T21:00:00Z'))).toBe(true);
    // Yil donumu: 31 Aralik 21.00 UTC Istanbul da yeni yil.
    expect(isCardExpired(12, 2026, new Date('2026-12-31T21:00:00Z'))).toBe(true);
    expect(isCardExpired(1, 2027, new Date('2026-12-31T21:00:00Z'))).toBe(false);
  });

  it('numara sorunu: bicim ve Luhn bir cumle, uzunluk bir cumle, bilinmeyen marka bir cumle', () => {
    expect(cardNumberProblem(NUMBERS.visa)).toBeNull();
    expect(cardNumberProblem('4242424242424241')).toBe(CARD_FIELD_MESSAGES.number);
    expect(cardNumberProblem('4242abcd42424242')).toBe(CARD_FIELD_MESSAGES.number);
    expect(cardNumberProblem(NUMBERS.discover)).toBe(CARD_FIELD_MESSAGES.brand);
    expect(cardNumberProblem(NUMBERS.troy65)).toBe(CARD_FIELD_MESSAGES.brand);
  });

  it('uzunluk hatasi uzunluk cumlesini alir: 12 ve 20 hane, 18 haneli Visa, 19 haneli Mastercard (QA B3)', () => {
    expect(cardNumberProblem('424242424242')).toBe(CARD_FIELD_MESSAGES.numberLength);
    expect(cardNumberProblem('42424242424242424242')).toBe(CARD_FIELD_MESSAGES.numberLength);
    // Ikisi de Luhn dan gecer ve markasi bilinir; yalnizca hane sayisi markaya uymaz.
    for (const number of [NUMBERS.visa18, NUMBERS.mastercard19, NUMBERS.amex16]) {
      expect(isLuhnValid(number), number).toBe(true);
    }
    expect(cardNumberProblem(NUMBERS.visa18)).toBe(CARD_FIELD_MESSAGES.numberLength);
    expect(cardNumberProblem(NUMBERS.mastercard19)).toBe(CARD_FIELD_MESSAGES.numberLength);
    expect(cardNumberProblem(NUMBERS.amex16)).toBe(CARD_FIELD_MESSAGES.numberLength);
  });

  it('kart uzerindeki ad: once NFC; en az bir harf; yalnizca noktalama ve bicim karakteri gecmez (QA B2)', () => {
    // "s" + birlestirici cengel (U+0327): NFC ile tek harf "ş" olur ve gecer.
    const decomposed = 'Ays\u0327e Yılmaz';
    expect(normalizeCardText(` ${decomposed} `)).toBe('Ayşe Yılmaz');
    expect(cardHolderNameProblem(normalizeCardText(decomposed))).toBeNull();
    expect(cardHolderNameProblem("J. O'Neil-Smith")).toBeNull();
    for (const name of ['..', "'-", ' . ', 'Ayşe\u202E', 'Ay\u200Bşe', 'Ayşe\tY', 'Ayşe 2']) {
      expect(cardHolderNameProblem(name), JSON.stringify(name)).toBe(
        CARD_FIELD_MESSAGES.holderName,
      );
    }
  });

  it("kart adi: harf, rakam, bosluk ve . , ' -; bicim ve kontrol karakteri gecmez (QA S2)", () => {
    for (const nickname of ['', 'Maaş kartım', 'İş, 2026', "Ali'nin kartı - 1.", '1234567']) {
      expect(cardNicknameProblem(nickname), JSON.stringify(nickname)).toBeNull();
    }
    for (const nickname of [
      'Maaş\u202Ekartı',
      'Maaş\u200Bkartı',
      'Maaş\u2066kartı',
      'Maaş\tkartı',
      'Maaş\u0000',
      'Maaş\nkartı',
      'Maaş 💳',
      'Kart/1',
    ]) {
      expect(cardNicknameProblem(nickname), JSON.stringify(nickname)).toBe(
        CARD_FIELD_MESSAGES.nicknameCharacters,
      );
    }
    expect(cardNicknameProblem('x'.repeat(CARD_NICKNAME_MAX_LENGTH))).toBeNull();
    expect(cardNicknameProblem('x'.repeat(CARD_NICKNAME_MAX_LENGTH + 1))).toBe(
      CARD_FIELD_MESSAGES.nickname,
    );
  });

  it('kart adinda 8 ya da daha fazla yan yana rakam yok; ayraclar diziyi bolmez (QA S2)', () => {
    for (const nickname of [
      '12345678',
      'Kart 4242 4242 4242 4242',
      '4242-4242-4242-4242',
      '4242.4242.4242.4242',
      "4242,4242'4242 4242",
      '4242 - 4242',
    ]) {
      expect(cardNicknameProblem(nickname), nickname).toBe(CARD_FIELD_MESSAGES.nicknameDigits);
    }
    // 7 yan yana rakam ve harfle bolunmus diziler gecer.
    expect(cardNicknameProblem('Kart 123 4567')).toBeNull();
    expect(cardNicknameProblem('4242 kart 4242 kart 4242')).toBeNull();
  });
});

describe('addCardRequestSchema (POST /v1/me/cards)', () => {
  it('gecerli istek gecer; ad ve kart adi kirpilir, numara oldugu gibi kalir (kasa atar)', () => {
    const parsed = addCardRequestSchema.parse({
      ...REQUEST,
      holderName: '  Ayşe Yılmaz ',
      nickname: ' Maaş kartım ',
    });

    expect(parsed).toEqual({ ...REQUEST, holderName: 'Ayşe Yılmaz', nickname: 'Maaş kartım' });
    expect(addCardRequestSchema.safeParse({ ...REQUEST, nickname: undefined }).success).toBe(true);
  });

  it('bos ya da yalnizca bosluk kart adi cikista yok (QA S4); ad NFC ye cevrilir', () => {
    for (const nickname of ['', '   ', ' \u00A0\t ']) {
      const parsed = addCardRequestSchema.parse({ ...REQUEST, nickname });
      expect(parsed.nickname).toBeUndefined();
    }
    const parsed = addCardRequestSchema.parse({ ...REQUEST, holderName: 'Ays\u0327e Yılmaz' });
    expect(parsed.holderName).toBe('Ayşe Yılmaz');
  });

  it('her alan kendi cumlesiyle reddedilir', () => {
    expect(
      fieldErrors({
        number: '4242424242424241',
        expiryMonth: 13,
        expiryYear: 31,
        cvv: '12',
        holderName: 'A',
        nickname: 'x'.repeat(31),
      }),
    ).toEqual({
      number: [CARD_FIELD_MESSAGES.number],
      expiryMonth: [CARD_FIELD_MESSAGES.expiryMonth],
      expiryYear: [CARD_FIELD_MESSAGES.expiryYear],
      cvv: [CARD_FIELD_MESSAGES.cvv],
      holderName: [CARD_FIELD_MESSAGES.holderName],
      nickname: [CARD_FIELD_MESSAGES.nickname],
    });
    expect(fieldErrors({ ...REQUEST, number: NUMBERS.discover })).toEqual({
      number: [CARD_FIELD_MESSAGES.brand],
    });
    expect(fieldErrors({ ...REQUEST, holderName: 'Ayşe 2' })).toEqual({
      holderName: [CARD_FIELD_MESSAGES.holderName],
    });
  });

  it('CVV uzunlugu markaya gore: Amex 4 hane ister, Visa 4 haneyi reddeder', () => {
    expect(fieldErrors({ ...REQUEST, number: NUMBERS.amex, cvv: '1234' })).toEqual({});
    expect(fieldErrors({ ...REQUEST, number: NUMBERS.amex, cvv: '123' })).toEqual({
      cvv: [CARD_FIELD_MESSAGES.cvv],
    });
    expect(fieldErrors({ ...REQUEST, cvv: '1234' })).toEqual({ cvv: [CARD_FIELD_MESSAGES.cvv] });
  });

  it('eksik ya da yanlis turdeki alan da ayni cumle; tur adi bile yazilmaz', () => {
    expect(fieldErrors({})).toEqual({
      number: [CARD_FIELD_MESSAGES.number],
      expiryMonth: [CARD_FIELD_MESSAGES.expiryMonth],
      expiryYear: [CARD_FIELD_MESSAGES.expiryYear],
      cvv: [CARD_FIELD_MESSAGES.cvv],
      holderName: [CARD_FIELD_MESSAGES.holderName],
    });
    expect(fieldErrors({ ...REQUEST, number: 4242424242424242, cvv: 123 })).toEqual({
      number: [CARD_FIELD_MESSAGES.number],
      cvv: [CARD_FIELD_MESSAGES.cvv],
    });
  });

  it('DEGER YANKILANMAZ: hata cikisinda girilen numara, CVV ve parcasi yok', () => {
    const secrets = [
      { number: '4242 4242 4242 4241', cvv: '987' },
      { number: NUMBERS.discover, cvv: '4321' },
      { number: '4111111111111111abc', cvv: '9a9' },
      { number: NUMBERS.amex, cvv: '765' },
      { number: NUMBERS.visa18, cvv: '5310' },
    ];
    for (const [index, secret] of secrets.entries()) {
      // Kart adi da numarayi tasir: rakam dizisi ve bicim karakteri yollarinin
      // ikisinde de cumle degeri yankilamamali.
      const nickname = index % 2 === 0 ? `Kart ${secret.number}` : `${secret.number}\u202E`;
      const result = addCardRequestSchema.safeParse({
        ...REQUEST,
        ...secret,
        expiryMonth: 0,
        nickname,
      });
      expect(result.success).toBe(false);
      const output = JSON.stringify(result.success ? {} : result.error.format());
      const digits = normalizeCardNumber(secret.number).replace(/\D/g, '');
      for (const fragment of [
        secret.number,
        digits,
        digits.slice(0, 6),
        digits.slice(-4),
        secret.cvv,
      ]) {
        expect(output, `yankilanan: ${fragment.length} karakter`).not.toContain(fragment);
      }
      expect(Object.values(CARD_FIELD_MESSAGES).join(' ')).not.toMatch(/\d{4}/);
    }
  });
});

describe('savedCardSchema / savedCardListSchema (maskeli cevap)', () => {
  const card = {
    id: CARD_ID,
    brand: 'VISA',
    first4: '4242',
    last4: '4242',
    expiryMonth: 12,
    expiryYear: 2031,
    holderName: 'Ayşe Yılmaz',
    nickname: 'Maaş kartım',
    expired: false,
    createdAt: '2026-10-05T12:00:00.000Z',
  } as const;

  it('maskeli kart gecer; kart adi istege bagli; hane ve kimlik bicimi denetlenir', () => {
    expect(savedCardSchema.parse(card)).toEqual(card);
    const { nickname: _nickname, ...withoutNickname } = card;
    expect(savedCardSchema.safeParse(withoutNickname).success).toBe(true);
    expect(savedCardSchema.safeParse({ ...card, last4: '42424' }).success).toBe(false);
    expect(savedCardSchema.safeParse({ ...card, brand: 'DISCOVER' }).success).toBe(false);
    expect(savedCardSchema.safeParse({ ...card, id: 'crd_1' }).success).toBe(false);
  });

  it('cevapta tam numara ve CVV alani TASINMAZ (bilinmeyen alan atilir)', () => {
    const parsed = savedCardSchema.parse({ ...card, number: NUMBERS.visa, cvv: '123' });

    expect(parsed).not.toHaveProperty('number');
    expect(parsed).not.toHaveProperty('cvv');
  });

  it(`liste en fazla ${SAVED_CARDS_MAX} kart; bos liste gecerli`, () => {
    expect(savedCardListSchema.safeParse({ items: [] }).success).toBe(true);
    expect(
      savedCardListSchema.safeParse({ items: Array.from({ length: SAVED_CARDS_MAX }, () => card) })
        .success,
    ).toBe(true);
    expect(
      savedCardListSchema.safeParse({
        items: Array.from({ length: SAVED_CARDS_MAX + 1 }, () => card),
      }).success,
    ).toBe(false);
  });

  it('kart kimligi yalnizca crd_ + 32 onaltilik', () => {
    expect(cardIdSchema.safeParse(CARD_ID).success).toBe(true);
    expect(cardIdSchema.safeParse('adr_0123456789abcdef0123456789abcdef').success).toBe(false);
    expect(cardIdSchema.safeParse(`${CARD_ID}0`).success).toBe(false);
  });
});
