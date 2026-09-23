/**
 * Siparis deposu SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration) kosar. MOCK modu ile gercek mod ayni surum kontrolunu,
 * ayni hatalari ve ayni gecmis sirasini gostermeli.
 *
 * Mongo'da koleksiyon testler arasinda paylasilir; bu yuzden her test kendi
 * kullanicisini (benzersiz userId) acar ve yalnizca onu sorgular.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import type { OrderHistoryCursor } from '../../src/domain/order-history-cursor.js';
import type { OrderHistoryReader } from '../../src/domain/order-history-reader.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import type { Order } from '../../src/domain/order.js';
import { createDraftOrder, TIMELINE_NOTE, transitionOrder } from '../../src/domain/order.js';

export type OrderStoreUnderTest = OrderRepository & OrderHistoryReader;

const START_MS = 1_760_000_000_000;
const MINUTE_MS = 60_000;

export function describeOrderStoreContract(
  name: string,
  getStore: () => OrderStoreUnderTest,
): void {
  let userCounter = 0;
  const newUserId = (): string => {
    userCounter += 1;
    return `usr_contract-${name}-${userCounter}`;
  };

  function draftAt(userId: string, epochMs: number): Order {
    return createDraftOrder(
      {
        userId,
        marketId: 'mkt_migros-jet-moda',
        lines: [{ productId: 'prd_sut-1l', sku: 'SUT-1L', quantity: 2 }],
        deliveryLocation: { lat: 40.9885, lng: 29.0262 },
        deliveryAddress: 'Caferağa, Kadıköy',
      },
      fixedClock(epochMs),
    );
  }

  describe(`OrderRepository sozlesmesi: ${name}`, () => {
    it('yazilan siparis ALAN KAYBI olmadan geri okunur (timeline notu ve tarihler dahil)', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      const walked = transitionOrder(
        draft,
        ORDER_STATUS.RISK_CHECK,
        fixedClock(START_MS + 1_000),
        TIMELINE_NOTE.PENDING_RISK_SERVICE,
      );

      await store.insert(walked);

      const read = await store.findById(walked.id);
      expect(read).toEqual(walked);
      expect(read?.timeline[1]?.at).toBeInstanceOf(Date);
    });

    it('olmayan kimlik: null', async () => {
      await expect(getStore().findById('ord_00000000000000000000000000000000')).resolves.toBeNull();
    });

    it('ayni kimlikle ikinci insert CONFLICT', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      await store.insert(draft);

      const failing = store.insert(draft);

      await expect(failing).rejects.toBeInstanceOf(AppError);
      await expect(failing).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
        details: { orderId: draft.id },
      });
    });

    it('dogru surumle update yazar', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      await store.insert(draft);

      const cancelled = transitionOrder(draft, ORDER_STATUS.CANCELLED, fixedClock(START_MS + 5));
      await store.update(cancelled, draft.version);

      await expect(store.findById(draft.id)).resolves.toMatchObject({
        status: ORDER_STATUS.CANCELLED,
        version: draft.version + 1,
      });
    });

    it('eski surumle update CONFLICT ve kayit DEGISMEZ (es zamanli iki yazma)', async () => {
      const store = getStore();
      const draft = draftAt(newUserId(), START_MS);
      await store.insert(draft);
      // Iki istek ayni taslagi okudu; ilki iptal etti...
      const first = transitionOrder(draft, ORDER_STATUS.CANCELLED, fixedClock(START_MS + 5));
      await store.update(first, draft.version);

      // ...ikincisi hala eski surumu biliyor.
      const second = transitionOrder(draft, ORDER_STATUS.RISK_CHECK, fixedClock(START_MS + 6));
      const failing = store.update(second, draft.version);

      await expect(failing).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
        details: { orderId: draft.id, expectedVersion: draft.version },
      });
      await expect(store.findById(draft.id)).resolves.toMatchObject({
        status: ORDER_STATUS.CANCELLED,
      });
    });

    it('olmayan siparisi update CONFLICT (sessizce yeni kayit ACILMAZ)', async () => {
      const store = getStore();
      const ghost = draftAt(newUserId(), START_MS);

      await expect(store.update(ghost, ghost.version)).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
      });
      await expect(store.findById(ghost.id)).resolves.toBeNull();
    });
  });

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
