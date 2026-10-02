/**
 * ExpiredOrderFinder portunun sozlesmesi (T11.2 PR 2): supurucunun is kuyrugu.
 *
 * Mongo'da koleksiyon testler arasinda paylasilir ve sorgu kullaniciya ozel
 * DEGILDIR. Bu yuzden her test kendi zaman penceresini kullanir ve pencereler
 * gecmise dogru siralanir: sonraki testin `now`'i oncekilerin kilitlerinden
 * oncedir, onlari gormez. Diger sozlesmelerin taslaklari kilitsizdir.
 */

import { ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { fixedClock } from '@getir/core';
import { describe, expect, it } from 'vitest';

import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { rescheduleReservation } from '../../src/domain/stock-reservation.js';
import type { OrderStoreFixtures, OrderStoreUnderTest } from './order-store-fixtures.js';
import { MINUTE_MS, START_MS } from './order-store-fixtures.js';

const DAY_MS = 24 * 60 * MINUTE_MS;

const TO_AWAITING: readonly OrderStatus[] = [
  ORDER_STATUS.RISK_CHECK,
  ORDER_STATUS.RESERVED,
  ORDER_STATUS.AWAITING_PAYMENT,
];

export function describeExpiredOrderFinderContract(
  name: string,
  getStore: () => OrderStoreUnderTest,
  { newUserId, draftAt }: OrderStoreFixtures,
): void {
  /** Kilidi `expiresAtMs`'de dolan, verilen duruma yurutulmus siparis. */
  const lockedAt = (
    base: number,
    expiresAtMs: number,
    steps: readonly OrderStatus[] = [],
  ): Order => {
    const draft = draftAt(newUserId(), base);
    const locked: Order = {
      ...draft,
      reservation: { reservedAt: new Date(base), expiresAt: new Date(expiresAtMs) },
    };
    return steps.reduce<Order>(
      (order, status) => transitionOrder(order, status, fixedClock(base)),
      locked,
    );
  };

  describe(`ExpiredOrderFinder sozlesmesi: ${name}`, () => {
    it('kilidi dolmus DRAFT ve AWAITING_PAYMENT; kilidi once dolan once, bitis ani dahil', async () => {
      const store = getStore();
      const base = START_MS - 10 * DAY_MS;
      const now = base + 5 * MINUTE_MS;
      const draftLate = lockedAt(base, base + 2 * MINUTE_MS);
      const awaitingEarly = lockedAt(base, base + MINUTE_MS, TO_AWAITING);
      const atBoundary = lockedAt(base, now);
      const ignored = [
        lockedAt(base, base + 10 * MINUTE_MS), // kilit suruyor
        draftAt(newUserId(), base), // kilitsiz (T11.2 oncesi)
        lockedAt(base, base + MINUTE_MS, [...TO_AWAITING, ORDER_STATUS.PAID]),
        lockedAt(base, base + MINUTE_MS, [ORDER_STATUS.CANCELLED]),
      ];
      for (const order of [draftLate, ...ignored, atBoundary, awaitingEarly]) {
        await store.insert(order, []);
      }

      const expired = await store.findExpiredReservations(new Date(now), 10);

      expect(expired.map((order) => order.id)).toEqual([
        awaitingEarly.id,
        draftLate.id,
        atBoundary.id,
      ]);
      expect(expired[0]?.reservation).toEqual(awaitingEarly.reservation);
    });

    it('en fazla `limit`; ayni bitis aninda kimlik sirasi', async () => {
      const store = getStore();
      const base = START_MS - 20 * DAY_MS;
      const same = base + MINUTE_MS;
      const pair = [lockedAt(base, same), lockedAt(base, same)];
      for (const order of pair) {
        await store.insert(order, []);
      }

      const first = await store.findExpiredReservations(new Date(base + 2 * MINUTE_MS), 1);

      const [smaller] = pair.map((order) => order.id).sort();
      expect(first.map((order) => order.id)).toEqual([smaller]);
    });

    it('odeme oncesi uzatilan kilit (T11.3): yeni bitis yazilir, supurucu eski bitiste BULMAZ, eski surumle yazan CONFLICT', async () => {
      const store = getStore();
      const base = START_MS - 30 * DAY_MS;
      const awaiting = lockedAt(base, base + MINUTE_MS, TO_AWAITING);
      await store.insert(awaiting, []);
      const extended = rescheduleReservation(
        awaiting,
        new Date(base + 2 * MINUTE_MS),
        new Date(base + 30_000),
      );

      await store.update(extended, awaiting.version, []);

      const atOldExpiry = new Date(base + MINUTE_MS + 30_000);
      expect((await store.findExpiredReservations(atOldExpiry, 10)).map((o) => o.id)).not.toContain(
        awaiting.id,
      );
      expect(await store.findById(awaiting.id)).toEqual(extended);
      await expect(
        store.update(
          transitionOrder(awaiting, ORDER_STATUS.CANCELLED, fixedClock(base)),
          awaiting.version,
          [],
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
      const atNewExpiry = new Date(base + 2 * MINUTE_MS);
      expect((await store.findExpiredReservations(atNewExpiry, 10)).map((o) => o.id)).toContain(
        awaiting.id,
      );
    });
  });
}
