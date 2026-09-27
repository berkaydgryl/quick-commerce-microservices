/**
 * OrderHistoryReader portunun sozlesmesi: kullaniciya ozel, yeniden eskiye
 * siralama ve imlecle kayipsiz sayfalama. Veri hazirlamak icin depoya yazar;
 * bu yuzden ikisini birlikte ister.
 */

import { describe, expect, it } from 'vitest';

import type { OrderHistoryCursor } from '../../src/domain/order-history-cursor.js';
import type { OrderStoreFixtures, OrderStoreUnderTest } from './order-store-fixtures.js';
import { MINUTE_MS, START_MS } from './order-store-fixtures.js';

export function describeOrderHistoryReaderContract(
  name: string,
  getStore: () => OrderStoreUnderTest,
  { newUserId, draftAt }: OrderStoreFixtures,
): void {
  describe(`OrderHistoryReader sozlesmesi: ${name}`, () => {
    it('yeniden eskiye, yalnizca o kullanicinin siparisleri', async () => {
      const store = getStore();
      const userId = newUserId();
      const oldest = draftAt(userId, START_MS);
      const middle = draftAt(userId, START_MS + MINUTE_MS);
      const newest = draftAt(userId, START_MS + 2 * MINUTE_MS);
      // Ekleme sirasi kasten karisik: sira yazma sirasindan degil createdAt'ten gelir.
      for (const order of [middle, oldest, newest, draftAt(newUserId(), START_MS)]) {
        await store.insert(order);
      }

      const page = await store.listByUser({ userId, pageSize: 10 });

      expect(page.orders.map((order) => order.id)).toEqual([newest.id, middle.id, oldest.id]);
      expect(page.next).toBeUndefined();
    });

    it('ayni milisaniyedeki siparisler kimlige gore azalan (esitlik bozucu)', async () => {
      const store = getStore();
      const userId = newUserId();
      const twins = [draftAt(userId, START_MS), draftAt(userId, START_MS)];
      for (const order of twins) {
        await store.insert(order);
      }

      const page = await store.listByUser({ userId, pageSize: 10 });

      const expected = twins
        .map((order) => order.id)
        .sort()
        .reverse();
      expect(page.orders.map((order) => order.id)).toEqual(expected);
    });

    it('imlecle sayfalar: kayip ve tekrar yok, esitlik sinirda da dogru', async () => {
      const store = getStore();
      const userId = newUserId();
      // 5 siparis, ikisi AYNI anda: sayfa siniri tam esitligin ortasina dusebilir.
      const orders = [0, 1, 1, 2, 3].map((minute) =>
        draftAt(userId, START_MS + minute * MINUTE_MS),
      );
      for (const order of orders) {
        await store.insert(order);
      }

      const seen: string[] = [];
      let after: OrderHistoryCursor | undefined;
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const page = await store.listByUser({ userId, pageSize: 2, after });
        seen.push(...page.orders.map((order) => order.id));
        if (page.next === undefined) {
          break;
        }
        after = page.next;
      }

      expect(seen).toHaveLength(orders.length);
      expect(new Set(seen).size).toBe(orders.length);
    });

    it('sayfa tam dolunca son sayfada imlec YOK (bos ucuncu sayfa istenmez)', async () => {
      const store = getStore();
      const userId = newUserId();
      for (const minute of [0, 1]) {
        await store.insert(draftAt(userId, START_MS + minute * MINUTE_MS));
      }

      const page = await store.listByUser({ userId, pageSize: 2 });

      expect(page.orders).toHaveLength(2);
      expect(page.next).toBeUndefined();
    });

    it('siparisi olmayan kullanici: bos liste', async () => {
      const page = await getStore().listByUser({ userId: newUserId(), pageSize: 10 });

      expect(page).toEqual({ orders: [], next: undefined });
    });
  });
}
