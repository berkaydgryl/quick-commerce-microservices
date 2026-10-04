/**
 * AwaitingCourierFinder portunun sozlesmesi (T13.1 PR 2): kurye iscisinin is
 * kuyrugu. Ayni senaryolar bellekte (unit) ve gercek Mongo'da (integration).
 *
 * Mongo'da koleksiyon testler arasinda paylasilir ve odenmis (PAID) her siparis
 * sorguya girer: diger sozlesmeler de PAID yazar. Bu yuzden senaryolar sonucu
 * KENDI siparislerine suzer; sira, kendi siparislerinin birbirine gore
 * sirasidir. `limit` sozlesmesi ise "tam listenin oneki" olarak denenir.
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { withAssignedCourier, withCourierRetry } from '../../src/domain/courier-dispatch.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import type { OrderStoreFixtures, OrderStoreUnderTest } from './order-store-fixtures.js';
import { MINUTE_MS, START_MS } from './order-store-fixtures.js';

const DAY_MS = 24 * 60 * MINUTE_MS;

const TO_PAID: readonly OrderStatus[] = [
  ORDER_STATUS.RISK_CHECK,
  ORDER_STATUS.RESERVED,
  ORDER_STATUS.AWAITING_PAYMENT,
  ORDER_STATUS.PAID,
];

export function describeAwaitingCourierFinderContract(
  name: string,
  getStore: () => OrderStoreUnderTest,
  { newUserId, draftAt }: OrderStoreFixtures,
): void {
  /** `base` aninda acilip verilen duruma yurutulmus siparis. */
  const orderIn = (base: number, steps: readonly OrderStatus[]): Order =>
    steps.reduce<Order>(
      (order, status) => transitionOrder(order, status, fixedClock(base)),
      draftAt(newUserId(), base),
    );
  const paid = (base: number) => orderIn(base, TO_PAID);
  const waiting = (base: number, retryAtMs: number) =>
    withCourierRetry(paid(base), new Date(retryAtMs), fixedClock(base));

  const ownIds = async (store: OrderStoreUnderTest, now: number, mine: readonly Order[]) => {
    const ids = new Set(mine.map((order) => order.id));
    const found = await store.findAwaitingCourier(new Date(now), 10_000);
    return found.map((order) => order.id).filter((id) => ids.has(id));
  };

  describe(`AwaitingCourierFinder sozlesmesi: ${name}`, () => {
    it('odenmisler once, sonra deneme ani gelmis kuryesiz PREPARING (an dahil, en eski once)', async () => {
      const store = getStore();
      const base = START_MS - 40 * DAY_MS;
      const now = base + 5 * MINUTE_MS;
      const freshPaid = paid(base);
      const lateRetry = waiting(base, base + 2 * MINUTE_MS);
      const earlyRetry = waiting(base, base + MINUTE_MS);
      const atBoundary = waiting(base, now);
      const ignored = [
        waiting(base, now + 1), // deneme ani gelmedi
        withAssignedCourier(paid(base), 'crr_1', fixedClock(base)), // kuryesi var
        orderIn(base, [...TO_PAID, ORDER_STATUS.PREPARING]), // deneme ani yok (eski kayit)
        orderIn(base, TO_PAID.slice(0, 3)), // odeme bekliyor
        orderIn(base, [...TO_PAID, ORDER_STATUS.CANCELLED]),
      ];
      const mine = [lateRetry, ...ignored, atBoundary, freshPaid, earlyRetry];
      for (const order of mine) {
        await store.insert(order, []);
      }

      expect(await ownIds(store, now, mine)).toEqual([
        freshPaid.id,
        earlyRetry.id,
        lateRetry.id,
        atBoundary.id,
      ]);
    });

    it('en fazla `limit`: tam listenin oneki', async () => {
      const store = getStore();
      const base = START_MS - 50 * DAY_MS;
      for (const order of [paid(base), waiting(base, base), waiting(base, base + 1)]) {
        await store.insert(order, []);
      }
      const now = new Date(base + MINUTE_MS);

      const all = await store.findAwaitingCourier(now, 10_000);
      const limited = await store.findAwaitingCourier(now, 2);

      expect(limited.map((order) => order.id)).toEqual(all.slice(0, 2).map((order) => order.id));
    });

    it('kurye alanlari aynen saklanir; kurye yazilinca siparis kuyruktan cikar', async () => {
      const store = getStore();
      const base = START_MS - 60 * DAY_MS;
      const before = waiting(base, base);
      await store.insert(before, []);
      expect(await store.findById(before.id)).toEqual(before);

      const assigned = withAssignedCourier(before, 'crr_9', fixedClock(base + MINUTE_MS));
      await store.update(assigned, before.version, []);

      expect(await store.findById(before.id)).toEqual(assigned);
      expect(await ownIds(store, base + 2 * MINUTE_MS, [before])).toEqual([]);
    });
  });
}
