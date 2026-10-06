/**
 * Kart kasasinin bellek deposu, Mongo uygulamasiyla AYNI sozlesmeden gecer;
 * gercek Mongo kosusu test/integration/mongo-card-store.spec.ts icindedir.
 */

import { SAVED_CARDS_MAX } from '@getir/contracts';
import { ID_PREFIX, newId } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { CARD_STATUS } from '../../src/domain/card.js';
import { InMemoryCardStore } from '../../src/infrastructure/memory/in-memory-card-store.js';
import { describeCardStoreContract } from '../support/card-store-contract.js';

describeCardStoreContract('bellek', () => new InMemoryCardStore());

describe('InMemoryCardStore yumusak silme', () => {
  it('silinen kartin saglayici jetonu kayitta kalmaz; durum DELETED ve silme ani yazilir (QA P5)', async () => {
    const store = new InMemoryCardStore();
    const id = newId(ID_PREFIX.CARD);
    const at = new Date('2026-10-05T12:00:00Z');
    await store.add(
      {
        id,
        userId: 'usr_1',
        brand: 'VISA',
        first4: '4242',
        last4: '4242',
        expiryMonth: 12,
        expiryYear: 2031,
        holderName: 'Ayşe Yılmaz',
        providerToken: 'tok_test_4242',
        status: CARD_STATUS.ACTIVE,
        createdAt: at,
      },
      SAVED_CARDS_MAX,
    );

    await store.softDelete('usr_1', id, at);

    const stored = store.stored(id);
    expect(stored).toMatchObject({ status: CARD_STATUS.DELETED, deletedAt: at });
    expect(stored).not.toHaveProperty('providerToken');
  });
});
