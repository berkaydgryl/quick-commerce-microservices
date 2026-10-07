/**
 * Kart kasasi deposu SOZLESME testi (T11.17): ayni senaryolar bellekte (unit) ve
 * gercek Mongo'da (integration) kosar. Iki depo ayni kurallari (kasa siniri,
 * kullanicinin kasasinda ayni kart, yumusak silme) ve ayni hatalari gostermeli;
 * alan kaybi olmamali. Es zamanli senaryolar Mongo'da sayac transaction'ini
 * sinar (QA P4); bellekte ekleme zaten esli tek adimdir.
 *
 * Koleksiyon testler arasinda paylasilir: her test kendi kullanicisini acar.
 */

import { SAVED_CARDS_MAX } from '@getir/contracts';
import { ERROR_CODES, ID_PREFIX, newId } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { CARD_STATUS } from '../../src/domain/card.js';
import type { Card } from '../../src/domain/card.js';
import type { CardRepository } from '../../src/domain/card-repository.js';

const START_MS = 1_790_000_000_000;

type CardOverrides = { -readonly [K in keyof Card]?: Card[K] };

export function describeCardStoreContract(name: string, getStore: () => CardRepository): void {
  let sequence = 0;
  const newUser = (): string => {
    sequence += 1;
    return `usr_kasa-${name}-${sequence}`;
  };
  const card = (userId: string, overrides: CardOverrides = {}): Card => {
    sequence += 1;
    return {
      id: newId(ID_PREFIX.CARD),
      userId,
      brand: 'VISA',
      first4: '4242',
      last4: '4242',
      expiryMonth: 12,
      expiryYear: 2031,
      holderName: 'Ayşe Yılmaz',
      providerToken: 'tok_test_4242',
      status: CARD_STATUS.ACTIVE,
      createdAt: new Date(START_MS + sequence * 1_000),
      ...overrides,
    };
  };
  /** Ayni numara, farkli son kullanma ayi: farkli kart (ayni kart anahtari degil). */
  const monthly = (userId: string, month: number): Card => card(userId, { expiryMonth: month });

  describe(`CardRepository sozlesmesi: ${name}`, () => {
    it('eklenen kart ALAN KAYBI olmadan listede; kart adi varsa var, yoksa alan yok', async () => {
      const store = getStore();
      const userId = newUser();
      const plain = card(userId);
      const named = card(userId, { nickname: 'Maaş kartım', expiryMonth: 1 });

      await store.add(plain, SAVED_CARDS_MAX);
      await store.add(named, SAVED_CARDS_MAX);

      const listed = await store.listActive(userId);
      expect(listed).toEqual([named, plain]);
      expect(listed[1]).not.toHaveProperty('nickname');
    });

    it('liste yeniden eskiye, ayni anda kimlik azalan; baska kullanicinin ve silinmis kart yok', async () => {
      const store = getStore();
      const userId = newUser();
      const at = new Date(START_MS);
      const [first, second, third] = [1, 2, 3].map((month) =>
        card(userId, { expiryMonth: month, createdAt: at }),
      );
      const later = card(userId, { expiryMonth: 4, createdAt: new Date(START_MS + 60_000) });
      for (const saved of [first, second, third, later]) {
        await store.add(saved as Card, SAVED_CARDS_MAX);
      }
      await store.add(card(newUser()), SAVED_CARDS_MAX);
      await store.softDelete(userId, (second as Card).id, new Date(START_MS + 120_000));

      const ids = (await store.listActive(userId)).map((saved) => saved.id);

      const sameMoment = [(first as Card).id, (third as Card).id].sort().reverse();
      expect(ids).toEqual([later.id, ...sameMoment]);
    });

    it('kasa siniri: sinirdaki kullanicida VALIDATION_FAILED, details.cards; silince yer acilir', async () => {
      const store = getStore();
      const userId = newUser();
      const cards = Array.from({ length: SAVED_CARDS_MAX }, (_, index) =>
        monthly(userId, index + 1),
      );
      for (const saved of cards) {
        await store.add(saved, SAVED_CARDS_MAX);
      }

      await expect(store.add(monthly(userId, 11), SAVED_CARDS_MAX)).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
        details: { cards: expect.any(String) as unknown },
      });

      await store.softDelete(userId, (cards[0] as Card).id, new Date(START_MS));
      await store.add(monthly(userId, 11), SAVED_CARDS_MAX);
      expect(await store.listActive(userId)).toHaveLength(SAVED_CARDS_MAX);
    });

    it('ayni kart kullanicinin kasasinda bir kez: CONFLICT, details.cardId KENDI karti; baska kullanicida serbest (QA P4)', async () => {
      const store = getStore();
      const owner = newUser();
      const other = newUser();
      const saved = card(owner);
      await store.add(saved, SAVED_CARDS_MAX);

      await expect(store.add(card(owner), SAVED_CARDS_MAX)).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
        details: { cardId: saved.id },
      });
      // Baska kullanicinin ayni karti engel degil; hata kimligi sizdirilmaz.
      await store.add(card(other), SAVED_CARDS_MAX);
      // Son kullanmasi farkli kart ayni kart degil.
      await store.add(card(owner, { expiryYear: 2032 }), SAVED_CARDS_MAX);

      expect(await store.listActive(owner)).toHaveLength(2);
      expect(await store.listActive(other)).toHaveLength(1);
    });

    it('yumusak silme: yalnizca kendi silinmemis karti; silinen kart listeden cikar ve yeniden eklenebilir (QA P5)', async () => {
      const store = getStore();
      const owner = newUser();
      const saved = card(owner);
      await store.add(saved, SAVED_CARDS_MAX);
      const at = new Date(START_MS + 5_000);

      expect(await store.softDelete(newUser(), saved.id, at)).toBe(false);
      expect(await store.softDelete(owner, newId(ID_PREFIX.CARD), at)).toBe(false);
      expect(await store.softDelete(owner, 'crd_bicim-disi', at)).toBe(false);
      expect(await store.softDelete(owner, saved.id, at)).toBe(true);
      expect(await store.softDelete(owner, saved.id, at)).toBe(false);
      expect(await store.listActive(owner)).toEqual([]);

      const again = card(owner);
      await store.add(again, SAVED_CARDS_MAX);
      expect((await store.listActive(owner)).map((listed) => listed.id)).toEqual([again.id]);
    });

    it('odeme icin kart (T12.4): yalnizca SAHIBININ silinmemis karti jetonuyla; digerleri null', async () => {
      const store = getStore();
      const owner = newUser();
      const saved = card(owner);
      await store.add(saved, SAVED_CARDS_MAX);

      expect(await store.findActive(owner, saved.id)).toMatchObject({
        id: saved.id,
        userId: owner,
        providerToken: 'tok_test_4242',
      });
      expect(await store.findActive(newUser(), saved.id)).toBeNull();
      expect(await store.findActive(owner, newId(ID_PREFIX.CARD))).toBeNull();
      await store.softDelete(owner, saved.id, new Date(START_MS + 5_000));
      expect(await store.findActive(owner, saved.id)).toBeNull();
    });

    it('es zamanli: ayni karta iki ekleme tek kart birakir; kaybeden CONFLICT ve kazananin kimligi (QA P4)', async () => {
      const store = getStore();
      const userId = newUser();
      const [left, right] = [card(userId), card(userId)];

      const results = await Promise.allSettled([
        store.add(left, SAVED_CARDS_MAX),
        store.add(right, SAVED_CARDS_MAX),
      ]);

      const listed = await store.listActive(userId);
      expect(listed).toHaveLength(1);
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: ERROR_CODES.CONFLICT,
        details: { cardId: listed[0]?.id },
      });
    });

    it(`es zamanli: ${SAVED_CARDS_MAX + 1} farkli kart ayni anda eklenince kasa ${SAVED_CARDS_MAX}'u asmaz (QA P4)`, async () => {
      const store = getStore();
      const userId = newUser();
      const cards = Array.from({ length: SAVED_CARDS_MAX + 1 }, (_, index) =>
        monthly(userId, index + 1),
      );

      const results = await Promise.allSettled(
        cards.map((saved) => store.add(saved, SAVED_CARDS_MAX)),
      );

      expect(await store.listActive(userId)).toHaveLength(SAVED_CARDS_MAX);
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
        details: { cards: expect.any(String) as unknown },
      });
    });
  });
}
