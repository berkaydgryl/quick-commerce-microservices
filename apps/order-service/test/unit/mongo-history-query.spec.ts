/**
 * Gecmis Siparislerim'in Mongo tarafi (#101), Mongo'suz sinanabilen parcalar:
 * esleme her yazimda `inHistory`'yi kuraldan yazar; sorgu yalnizca `inHistory:
 * true` ister; kismi indeks yalnizca onlari tasir. Gercek sorgu plani ve
 * sayfalama: test/integration/mongo-order-store.spec.ts (explain) ve depo
 * sozlesmesi (order-history-listing-contract.ts).
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import type { Order } from '../../src/domain/order.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import {
  HISTORY_INDEX,
  HISTORY_INDEX_NAME,
  historyFilter,
} from '../../src/infrastructure/mongo/history-query.js';
import { fromOrderDocument, toOrderDocument } from '../../src/infrastructure/mongo/mappers.js';
import { sampleDraftInput } from '../support/order-builders.js';

const S = ORDER_STATUS;
const clock = fixedClock(1_760_000_000_000);

function walk(order: Order, ...steps: readonly OrderStatus[]): Order {
  return steps.reduce((current, status) => transitionOrder(current, status, clock), order);
}

describe('Mongo eslemesi: inHistory (#101)', () => {
  it('her yazimda kuraldan: taslak false, inceleme true, onayli odeme bekleyen false, odenmis true', () => {
    const draft = createDraftOrder(sampleDraftInput(), clock);
    const review = walk(draft, S.RISK_CHECK, S.REVIEW);
    const awaiting = walk(review, S.RESERVED, S.AWAITING_PAYMENT);
    const paid = walk(awaiting, S.PAID);

    expect(
      [draft, review, awaiting, paid].map((order) => toOrderDocument(order).inHistory),
    ).toEqual([false, true, false, true]);
  });

  it('iptal: odenmeden false, odendikten sonra true', () => {
    const draft = createDraftOrder(sampleDraftInput(), clock);

    expect(toOrderDocument(walk(draft, S.CANCELLED)).inHistory).toBe(false);
    expect(
      toOrderDocument(
        walk(draft, S.RISK_CHECK, S.RESERVED, S.AWAITING_PAYMENT, S.PAID, S.CANCELLED),
      ).inHistory,
    ).toBe(true);
  });

  it('turetilmis alan okumada domain nesnesine girmez', () => {
    const paid = walk(
      createDraftOrder(sampleDraftInput(), clock),
      S.RISK_CHECK,
      S.RESERVED,
      S.AWAITING_PAYMENT,
      S.PAID,
    );

    expect(fromOrderDocument(toOrderDocument(paid))).toEqual(paid);
    expect(fromOrderDocument(toOrderDocument(paid))).not.toHaveProperty('inHistory');
  });
});

describe('Gecmis sorgusu ve kismi indeks (#101)', () => {
  it('ilk sayfa: kullanici + yalnizca gecmiste gorunenler', () => {
    expect(historyFilter('usr_1', undefined)).toEqual({ userId: 'usr_1', inHistory: true });
  });

  it('imlecli sayfa: yine yalnizca gorunenler; aralik imlecle sinirli', () => {
    const createdAt = new Date('2026-10-07T10:00:00.000Z');

    expect(historyFilter('usr_1', { createdAt, orderId: 'ord_b' })).toEqual({
      userId: 'usr_1',
      inHistory: true,
      createdAt: { $lte: createdAt },
      $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: 'ord_b' } }],
    });
  });

  it('indeks kismi: yalnizca inHistory true; anahtar gecmis sirasiyla ayni', () => {
    expect(HISTORY_INDEX).toEqual({
      key: { userId: 1, createdAt: -1, _id: -1 },
      name: HISTORY_INDEX_NAME,
      partialFilterExpression: { inHistory: true },
    });
  });
});
