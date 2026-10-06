/**
 * DeleteCard use-case (T11.17): liste silmeden ONCE okunur (QA D5). Silme
 * yapildiktan sonra depo okumasi duserse silme basarisiz gorunmezdi; cevap
 * onceki listeden silinen kart cikarilarak kurulur.
 */

import { SAVED_CARDS_MAX } from '@getir/contracts';
import { ERROR_CODES, fixedClock, ID_PREFIX, newId } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import { describe, expect, it } from 'vitest';

import { createDeleteCard } from '../../src/application/delete-card.js';
import { CARD_STATUS } from '../../src/domain/card.js';
import type { Card } from '../../src/domain/card.js';
import type { CardRepository } from '../../src/domain/card-repository.js';
import { InMemoryCardStore } from '../../src/infrastructure/memory/in-memory-card-store.js';

const NOW_MS = Date.parse('2026-10-05T12:00:00Z');

function card(month: number): Card {
  return {
    id: newId(ID_PREFIX.CARD),
    userId: 'usr_sil',
    brand: 'VISA',
    first4: '4242',
    last4: '4242',
    expiryMonth: month,
    expiryYear: 2031,
    holderName: 'Ayşe Yılmaz',
    providerToken: 'tok_test_4242',
    status: CARD_STATUS.ACTIVE,
    createdAt: new Date(NOW_MS + month),
  };
}

/** Silmeden sonra okumayi yasaklayan depo: okuma duserse silme basarisiz gorunurdu. */
class NoReadAfterDelete implements CardRepository {
  private deleted = false;

  constructor(private readonly inner: InMemoryCardStore) {}

  add(saved: Card, limit: number): Promise<void> {
    return this.inner.add(saved, limit);
  }

  listActive(userId: string): Promise<readonly Card[]> {
    if (this.deleted) {
      return Promise.reject(new Error('silmeden sonra okuma: depo dustu'));
    }
    return this.inner.listActive(userId);
  }

  async softDelete(userId: string, cardId: string, at: Date): Promise<boolean> {
    const result = await this.inner.softDelete(userId, cardId, at);
    this.deleted = result;
    return result;
  }
}

describe('DeleteCard', () => {
  it('silmeden sonra depo okumasi gerekmez: cevap onceki liste eksi silinen kart (QA D5)', async () => {
    const inner = new InMemoryCardStore();
    const [first, second] = [card(1), card(2)];
    await inner.add(first, SAVED_CARDS_MAX);
    await inner.add(second, SAVED_CARDS_MAX);
    const deleteCard = createDeleteCard({
      repository: new NoReadAfterDelete(inner),
      clock: fixedClock(NOW_MS),
    });

    const remaining = await deleteCard(
      { userId: 'usr_sil', cardId: second.id },
      recordingLogger([]),
    );

    expect(remaining.map((saved) => saved.id)).toEqual([first.id]);
    expect(inner.stored(second.id)?.status).toBe(CARD_STATUS.DELETED);
  });

  it('kart yoksa NOT_FOUND; liste degismez', async () => {
    const inner = new InMemoryCardStore();
    const saved = card(1);
    await inner.add(saved, SAVED_CARDS_MAX);
    const deleteCard = createDeleteCard({ repository: inner, clock: fixedClock(NOW_MS) });

    await expect(
      deleteCard({ userId: 'usr_sil', cardId: newId(ID_PREFIX.CARD) }, recordingLogger([])),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(await inner.listActive('usr_sil')).toEqual([saved]);
  });
});
