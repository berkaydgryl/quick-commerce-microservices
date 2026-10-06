/**
 * CardMongoStore'un hata esleme kurali (T11.17, QA D1): eklemede CONFLICT
 * gelir de ayni kart bulunamazsa (cakisan yazim geri alindi, yeniden denemeler
 * tukendi) deponun ic ayrintili CONFLICT'i disari cikmaz; yeniden denenebilir
 * SERVICE_UNAVAILABLE doner. Gercek Mongo davranisi entegrasyon testindedir.
 */

import { SAVED_CARDS_MAX } from '@getir/contracts';
import { AppError, ERROR_CODES, ID_PREFIX, newId } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { CARD_STATUS } from '../../src/domain/card.js';
import type { Card } from '../../src/domain/card.js';
import { CardMongoStore } from '../../src/infrastructure/mongo/card-mongo-store.js';
import type { CardWalletsCollection } from '../../src/infrastructure/mongo/card-wallets-collection.js';
import type { CardsCollection } from '../../src/infrastructure/mongo/cards-collection.js';

const CARD: Card = {
  id: newId(ID_PREFIX.CARD),
  userId: 'usr_cakisma',
  brand: 'VISA',
  first4: '4242',
  last4: '4242',
  expiryMonth: 12,
  expiryYear: 2031,
  holderName: 'Ayşe Yılmaz',
  providerToken: 'tok_test_4242',
  status: CARD_STATUS.ACTIVE,
  createdAt: new Date('2026-10-05T12:00:00Z'),
};

/** mongo-kit'in tekil ihlal hatasi gibi: koleksiyon ve alan adlari ayrintida. */
const DUPLICATE = AppError.conflict('Kayit zaten var', {
  details: { operation: 'insertOne', collection: 'cards', fields: 'userId, first4, last4' },
});

function store(existing: { _id: string } | null): CardMongoStore {
  const cards = { findActiveByKey: () => Promise.resolve(existing) } as unknown as CardsCollection;
  const wallets = {} as CardWalletsCollection;
  const transactions = { withTransaction: () => Promise.reject(DUPLICATE) };
  return new CardMongoStore(cards, wallets, transactions);
}

describe('CardMongoStore.add hata eslemesi (QA D1)', () => {
  it('ayni kart bulunursa CONFLICT ve yalnizca var olan kartin kimligi', async () => {
    await expect(store({ _id: 'crd_var' }).add(CARD, SAVED_CARDS_MAX)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { cardId: 'crd_var' },
    });
  });

  it('ayni kart bulunamazsa SERVICE_UNAVAILABLE; deponun ic ayrintisi (koleksiyon, alanlar) yok', async () => {
    const error: unknown = await store(null)
      .add(CARD, SAVED_CARDS_MAX)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    expect(error).toHaveProperty('details', undefined);
    expect(JSON.stringify(error)).not.toMatch(/cards|insertOne|first4/);
  });
});
