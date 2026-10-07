/**
 * Kart adi duzenleme sozlesmesi (#148, PATCH /v1/me/cards/{cardId}): yalnizca
 * kart adi tasinir; kurallar eklemedekiyle AYNI; bos ad kaldirir, eksik alan
 * reddedilir; hata DEGER YANKILAMAZ (kart adi kisisel veridir).
 */

import { describe, expect, it } from 'vitest';

import {
  addCardRequestSchema,
  CARD_FIELD_MESSAGES,
  CARD_NICKNAME_MAX_LENGTH,
  updateCardNicknameRequestSchema,
} from '../../src/index.js';

/** Alan -> cumleler (zod format ciktisi). */
function nicknameErrors(body: unknown): string[] {
  const result = updateCardNicknameRequestSchema.safeParse(body);
  if (result.success) {
    return [];
  }
  return result.error.flatten().fieldErrors.nickname ?? [];
}

describe('updateCardNicknameRequestSchema (PATCH /v1/me/cards/{cardId}, #148)', () => {
  it('gecerli ad gecer: NFC ye cevrilir ve kirpilir', () => {
    const decomposed = 'Maş karti'; // "Maş kartı" ayrik bicimde (NFD)

    expect(updateCardNicknameRequestSchema.parse({ nickname: '  Maaş kartım  ' })).toEqual({
      nickname: 'Maaş kartım',
    });
    expect(updateCardNicknameRequestSchema.parse({ nickname: decomposed }).nickname).toBe(
      decomposed.normalize('NFC'),
    );
  });

  it('bos ya da yalnizca bosluk ad KALDIRIR: cikista alan undefined (eklemedeki S4 anlami)', () => {
    for (const nickname of ['', '   ', '\u00A0\u2003']) {
      expect(updateCardNicknameRequestSchema.parse({ nickname }), JSON.stringify(nickname)).toEqual(
        { nickname: undefined },
      );
    }
  });

  it('alan yoksa ya da null ise reddedilir ("Kart adı gönderilmedi"): bos govde ve null adi silmez', () => {
    // Gateway JSON null'u da eksik alan olarak iletir (proto optional): cumle ayni.
    for (const body of [{}, { nickname: undefined }, { nickname: null }]) {
      expect(nicknameErrors(body), JSON.stringify(body)).toEqual([
        CARD_FIELD_MESSAGES.nicknameMissing,
      ]);
    }
  });

  it('metin olmayan deger eklemedeki cumleyi alir (tur adi yazilmaz)', () => {
    for (const nickname of [42, true, ['Kart'], { ad: 'Kart' }]) {
      expect(nicknameErrors({ nickname }), JSON.stringify(nickname)).toEqual([
        CARD_FIELD_MESSAGES.nickname,
      ]);
    }
  });

  it('kurallar eklemedekiyle AYNI: uzunluk, karakter, 8+ yan yana rakam', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['x'.repeat(CARD_NICKNAME_MAX_LENGTH + 1), CARD_FIELD_MESSAGES.nickname],
      ['Maaş\u202Ekartı', CARD_FIELD_MESSAGES.nicknameCharacters],
      ['Kart/1', CARD_FIELD_MESSAGES.nicknameCharacters],
      ['4242 4242 4242 4242', CARD_FIELD_MESSAGES.nicknameDigits],
      ["4242,4242'4242 4242", CARD_FIELD_MESSAGES.nicknameDigits],
    ];
    for (const [nickname, message] of cases) {
      expect(nicknameErrors({ nickname }), JSON.stringify(nickname)).toEqual([message]);
      const added = addCardRequestSchema.safeParse({ nickname });
      const addErrors = added.success ? [] : (added.error.flatten().fieldErrors.nickname ?? []);
      expect(addErrors, `ekleme: ${JSON.stringify(nickname)}`).toEqual([message]);
    }
    expect(nicknameErrors({ nickname: 'x'.repeat(CARD_NICKNAME_MAX_LENGTH) })).toEqual([]);
  });

  it('SIKI: yalnizca kart adi kabul edilir; numara, CVV ve son kullanma REDDEDILIR (gateway gibi)', () => {
    for (const extra of [
      { number: '4242424242424242' },
      { cvv: '987' },
      { expiryMonth: 12, expiryYear: 2031 },
    ]) {
      const result = updateCardNicknameRequestSchema.safeParse({ nickname: 'İş', ...extra });
      expect(result.success, Object.keys(extra).join(',')).toBe(false);
      // Hata alan adini soyler, degeri yankilamaz.
      expect(JSON.stringify(result.success ? {} : result.error.issues)).not.toMatch(/4242|987/);
    }
  });

  it('DEGER YANKILANMAZ: reddedilen adin kendisi ve parcalari hata cikisinda yok', () => {
    for (const nickname of ['Zeynep 5321112233 kartı', 'Gizli\u202EMaaş', 'y'.repeat(40)]) {
      const result = updateCardNicknameRequestSchema.safeParse({ nickname });
      expect(result.success, nickname).toBe(false);
      const output = JSON.stringify(result.success ? {} : result.error.format());
      for (const fragment of [nickname, 'Zeynep', '5321112233', 'Gizli', 'yyyy']) {
        expect(output, `yankilanan: ${fragment.length} karakter`).not.toContain(fragment);
      }
    }
  });
});
