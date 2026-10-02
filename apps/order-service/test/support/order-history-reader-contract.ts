/**
 * OrderHistoryReader portunun sozlesmesi: kullaniciya ozel, yeniden eskiye
 * siralama ve imlecle kayipsiz sayfalama. Veri hazirlamak icin depoya yazar;
 * bu yuzden ikisini birlikte ister.
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import type { OrderHistoryCursor } from '../../src/domain/order-history-cursor.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
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
        await store.insert(order, []);
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
        await store.insert(order, []);
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
        await store.insert(order, []);
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
        await store.insert(draftAt(userId, START_MS + minute * MINUTE_MS), []);
      }

      const page = await store.listByUser({ userId, pageSize: 2 });

      expect(page.orders).toHaveLength(2);
      expect(page.next).toBeUndefined();
    });

    it('siparisi olmayan kullanici: bos liste', async () => {
      const page = await getStore().listByUser({ userId: newUserId(), pageSize: 10 });

      expect(page).toEqual({ orders: [], next: undefined });
    });

    it('hasPaidOrder: yalnizca odemesi ALINMIS siparis sayilir (ILK10)', async () => {
      const store = getStore();
      const userId = newUserId();

      await expect(store.hasPaidOrder(userId)).resolves.toBe(false);

      // Taslak ve iptal edilmis siparis "verilmis siparis" degildir.
      await store.insert(draftAt(userId, START_MS), []);
      await store.insert(walk(draftAt(userId, START_MS + 1), [ORDER_STATUS.CANCELLED]), []);
      await expect(store.hasPaidOrder(userId)).resolves.toBe(false);

      await store.insert(walk(draftAt(userId, START_MS + 2), TO_PAID), []);
      await expect(store.hasPaidOrder(userId)).resolves.toBe(true);
      // Baska kullanicinin odemesi bu kullaniciyi etkilemez.
      await expect(store.hasPaidOrder(newUserId())).resolves.toBe(false);
    });

    it('riskHistory (T7.1): teslim / iptal sayisi ve teslim edilenlerin ortalama sepeti', async () => {
      const store = getStore();
      const userId = newUserId();
      const withTotal = (order: Order, totalMinor: number): Order => ({
        ...order,
        pricing: { ...order.pricing, totalMinor },
      });

      await store.insert(walk(withTotal(draftAt(userId, START_MS), 7_990), TO_DELIVERED), []);
      await store.insert(walk(withTotal(draftAt(userId, START_MS + 1), 10_001), TO_DELIVERED), []);
      await store.insert(walk(draftAt(userId, START_MS + 2), [ORDER_STATUS.CANCELLED]), []);
      // Taslak ve odenmis ama teslim edilmemis siparis sayilmaz, ortalamaya girmez.
      await store.insert(draftAt(userId, START_MS + 3), []);
      await store.insert(walk(withTotal(draftAt(userId, START_MS + 4), 99_999), TO_PAID), []);
      // Baska kullanicinin teslimati bu kullaniciyi etkilemez.
      await store.insert(walk(draftAt(newUserId(), START_MS), TO_DELIVERED), []);

      // (7_990 + 10_001) / 2 = 8_995,5 -> tam sayi kurus: 8_996.
      await expect(store.riskHistory(userId)).resolves.toEqual({
        deliveredCount: 2,
        cancelledCount: 1,
        averageBasketMinor: 8_996,
      });
    });

    it('riskHistory (T11.2): sistemin iptalleri (stok yetmedi, sure doldu, sepet yenilendi) SAYILMAZ', async () => {
      const store = getStore();
      const userId = newUserId();
      const cancelledWith = (
        at: number,
        note: string | undefined,
        steps: readonly OrderStatus[] = [],
      ) =>
        transitionOrder(
          walk(draftAt(userId, at), steps),
          ORDER_STATUS.CANCELLED,
          fixedClock(at),
          note,
        );

      await store.insert(cancelledWith(START_MS, 'STOCK_INSUFFICIENT'), []);
      await store.insert(cancelledWith(START_MS + 1, 'RESERVATION_EXPIRED'), []);
      await store.insert(cancelledWith(START_MS + 2, 'CART_REPLACED'), []);
      // Odeme sirasinda kilit dustu: odeme bekleyen siparis sistemce iptal.
      await store.insert(
        cancelledWith(START_MS + 3, 'RESERVATION_EXPIRED', TO_PAID.slice(0, 3)),
        [],
      );
      // Kullanicinin iptalleri sayilir: notsuz, USER_CANCELLED ve kendi gerekcesi.
      await store.insert(cancelledWith(START_MS + 4, undefined), []);
      await store.insert(cancelledWith(START_MS + 5, 'USER_CANCELLED'), []);
      await store.insert(cancelledWith(START_MS + 6, 'CHANGED_MIND', TO_PAID.slice(0, 3)), []);

      await expect(store.riskHistory(userId)).resolves.toEqual({
        deliveredCount: 0,
        cancelledCount: 3,
      });
    });

    it('riskHistory: teslimati olmayan kullanicida ortalama YOK (0 degil)', async () => {
      await expect(getStore().riskHistory(newUserId())).resolves.toEqual({
        deliveredCount: 0,
        cancelledCount: 0,
      });
    });
  });
}

const TO_PAID: readonly OrderStatus[] = [
  ORDER_STATUS.RISK_CHECK,
  ORDER_STATUS.RESERVED,
  ORDER_STATUS.AWAITING_PAYMENT,
  ORDER_STATUS.PAID,
];

const TO_DELIVERED: readonly OrderStatus[] = [
  ...TO_PAID,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.ON_THE_WAY,
  ORDER_STATUS.DELIVERED,
];

/** Siparisi tablodaki yoldan verilen durumlara yurutur (sabit saat). */
function walk(order: Order, steps: readonly OrderStatus[]): Order {
  return steps.reduce(
    (current, status) => transitionOrder(current, status, fixedClock(START_MS)),
    order,
  );
}
