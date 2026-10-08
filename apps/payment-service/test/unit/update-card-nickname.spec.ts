/**
 * UpdateCardNickname use-case (#148): depo null donerse NOT_FOUND (uc durum
 * ayni); gunlukte yalnizca kimlikler ve "kaldirildi mi", ad degeri YOK.
 */

import { ERROR_CODES, ID_PREFIX, newId } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it } from 'vitest';

import { createUpdateCardNickname } from '../../src/application/update-card-nickname.js';
import { CARD_STATUS } from '../../src/domain/card.js';
import type { Card } from '../../src/domain/card.js';
import { InMemoryCardStore } from '../../src/infrastructure/memory/in-memory-card-store.js';

const USER = 'usr_ad-use-case';

function card(): Card {
  return {
    id: newId(ID_PREFIX.CARD),
    userId: USER,
    brand: 'VISA',
    first4: '4242',
    last4: '4242',
    expiryMonth: 12,
    expiryYear: 2031,
    holderName: 'Ayşe Yılmaz',
    nickname: 'Eski',
    providerToken: 'tok_test_4242',
    status: CARD_STATUS.ACTIVE,
    createdAt: new Date('2026-10-05T12:00:00Z'),
  };
}

describe('UpdateCardNickname', () => {
  it('adi yazar ve kaldirir; gunlukte ad degeri yok, kaldirma isareti var', async () => {
    const repository = new InMemoryCardStore();
    const saved = card();
    await repository.add(saved, 10);
    const lines: LogLine[] = [];
    const update = createUpdateCardNickname({ repository });

    const renamed = await update(
      { userId: USER, cardId: saved.id, nickname: 'Gizli Yeni' },
      recordingLogger(lines),
    );
    const cleared = await update(
      { userId: USER, cardId: saved.id, nickname: null },
      recordingLogger(lines),
    );

    expect(renamed.nickname).toBe('Gizli Yeni');
    expect(cleared).not.toHaveProperty('nickname');
    expect(lines.map((line) => line.fields)).toEqual([
      { userId: USER, cardId: saved.id, removed: false },
      { userId: USER, cardId: saved.id, removed: true },
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/Gizli Yeni|Eski/);
  });

  it('kart yok ya da baskasinin: NOT_FOUND, gunluk yok', async () => {
    const repository = new InMemoryCardStore();
    const saved = card();
    await repository.add(saved, 10);
    const lines: LogLine[] = [];
    const update = createUpdateCardNickname({ repository });

    for (const input of [
      { userId: 'usr_baska', cardId: saved.id, nickname: 'X' },
      { userId: USER, cardId: newId(ID_PREFIX.CARD), nickname: 'X' },
    ]) {
      await expect(update(input, recordingLogger(lines))).rejects.toMatchObject({
        code: ERROR_CODES.NOT_FOUND,
      });
    }
    expect(lines).toEqual([]);
  });
});
