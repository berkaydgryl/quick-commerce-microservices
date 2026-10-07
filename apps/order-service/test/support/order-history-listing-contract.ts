/**
 * Gecmis Siparislerim'in kapsami (#101), depo sozlesmesi: ListMyOrders
 * yalnizca gecmiste gorunen siparisleri (domain isListedInHistory) doner ve
 * suzme depodadir. Bellekte (unit) ve gercek Mongo'da (integration, inHistory
 * alani + kismi indeks) ayni senaryolar.
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { comesBefore, cursorOf } from '../../src/domain/order-history-cursor.js';
import type { OrderHistoryCursor } from '../../src/domain/order-history-cursor.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import type { OrderStoreFixtures, OrderStoreUnderTest } from './order-store-fixtures.js';
import { MINUTE_MS, START_MS, TO_DELIVERED, TO_PAID, walk } from './order-store-fixtures.js';

const S = ORDER_STATUS;
const TO_AWAITING: readonly OrderStatus[] = TO_PAID.slice(0, 3);

/** Gecmis sirasi (yeniden eskiye, esitlikte kimlik azalan): beklenen listeyi kurar. */
function newestFirst(orders: readonly Order[]): string[] {
  return [...orders]
    .sort((left, right) => (comesBefore(cursorOf(left), cursorOf(right)) ? -1 : 1))
    .map((order) => order.id);
}

export function describeOrderHistoryListingContract(
  name: string,
  getStore: () => OrderStoreUnderTest,
  { newUserId, draftAt }: OrderStoreFixtures,
): void {
  /** `steps` yolundan gecip son adimda `to`'ya `note` ile varan siparis. */
  const ended = (
    userId: string,
    at: number,
    steps: readonly OrderStatus[],
    to: OrderStatus,
    note?: string,
  ): Order => transitionOrder(walk(draftAt(userId, at), steps), to, fixedClock(at), note);

  /** Butun sayfalari imlecle okur; sayfa boylariyla birlikte. */
  const readAll = async (
    store: OrderStoreUnderTest,
    userId: string,
    pageSize: number,
  ): Promise<{ ids: string[]; sizes: number[] }> => {
    const ids: string[] = [];
    const sizes: number[] = [];
    let after: OrderHistoryCursor | undefined;
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const page = await store.listByUser({ userId, pageSize, after });
      ids.push(...page.orders.map((order) => order.id));
      sizes.push(page.orders.length);
      if (page.next === undefined) {
        break;
      }
      after = page.next;
    }
    return { ids, sizes };
  };

  describe(`Gecmis kapsami (#101): ${name}`, () => {
    it('yalnizca gercek siparisler: sepet asamasi, ret, odeme hatasi ve odenmeden iptal listede YOK', async () => {
      const store = getStore();
      const userId = newUserId();
      const at = (index: number): number => START_MS + index * MINUTE_MS;
      const hidden: Order[] = [
        draftAt(userId, at(0)),
        walk(draftAt(userId, at(2)), [S.RISK_CHECK]),
        walk(draftAt(userId, at(4)), [S.RISK_CHECK, S.RESERVED]),
        walk(draftAt(userId, at(6)), TO_AWAITING),
        walk(draftAt(userId, at(8)), [S.RISK_CHECK, S.RESERVED, S.EXPIRED]),
        walk(draftAt(userId, at(10)), [...TO_AWAITING, S.PAYMENT_FAILED]),
        walk(draftAt(userId, at(12)), [S.RISK_CHECK, S.REJECTED]),
        ended(userId, at(14), [], S.CANCELLED, 'CART_RELEASED'),
        ended(userId, at(16), [], S.CANCELLED, 'CART_REPLACED'),
        ended(userId, at(18), [], S.CANCELLED, 'STOCK_INSUFFICIENT'),
        ended(userId, at(20), TO_AWAITING, S.CANCELLED, 'RESERVATION_EXPIRED'),
        ended(userId, at(22), TO_AWAITING, S.CANCELLED, 'USER_CANCELLED'),
        ended(userId, at(24), [...TO_AWAITING, S.PAYMENT_FAILED], S.CANCELLED),
      ];
      const listed: Order[] = [
        walk(draftAt(userId, at(1)), [S.RISK_CHECK, S.REVIEW]),
        walk(draftAt(userId, at(3)), TO_PAID),
        walk(draftAt(userId, at(5)), [...TO_PAID, S.PREPARING]),
        walk(draftAt(userId, at(7)), [...TO_PAID, S.PREPARING, S.ON_THE_WAY]),
        walk(draftAt(userId, at(9)), TO_DELIVERED),
        // Odendikten sonra iptal (iade): notu ne olursa olsun gecmiste kalir.
        ended(userId, at(11), TO_PAID, S.CANCELLED, 'RESERVATION_EXPIRED'),
        // Kilidi dusup parasi iade edilen (#166): PAID kaydi yok, iade isareti var.
        {
          ...ended(userId, at(13), TO_AWAITING, S.CANCELLED, 'RESERVATION_EXPIRED'),
          refund: { reason: 'reservation_expired', requestedAt: new Date(at(13)) },
        },
      ];
      for (const order of [...hidden, ...listed]) {
        await store.insert(order, []);
      }

      const page = await store.listByUser({ userId, pageSize: 50 });

      expect(page.orders.map((order) => order.id)).toEqual(newestFirst(listed));
      expect(page.next).toBeUndefined();
    });

    it('her yazimda guncel: inceleme gorunur, onaydan sonra odeme beklerken cikar, odenince doner, iadede kalir', async () => {
      const store = getStore();
      const userId = newUserId();
      const ids = async (): Promise<string[]> =>
        (await store.listByUser({ userId, pageSize: 10 })).orders.map((order) => order.id);
      const draft = draftAt(userId, START_MS);
      await store.insert(draft, []);
      expect(await ids()).toEqual([]);

      const steps: readonly (readonly [readonly OrderStatus[], boolean])[] = [
        [[S.RISK_CHECK, S.REVIEW], true],
        // Bilinen kenar (kabul): onaylanan inceleme odeme beklerken listeden cikar.
        [[S.RESERVED, S.AWAITING_PAYMENT], false],
        [[S.PAID], true],
        [[S.CANCELLED], true],
      ];
      let current = draft;
      for (const [path, listed] of steps) {
        const next = walk(current, path);
        await store.update(next, current.version, []);
        current = next;
        expect(await ids()).toEqual(listed ? [draft.id] : []);
      }
    });

    it('sayfalama: taslaklar arada, sayfalar TAM dolu; tekrar ve atlama yok', async () => {
      const store = getStore();
      const userId = newUserId();
      // Ayni anda gorunen ikiz ve gorunen + gizli ikiz: sinir esitlige dusebilir.
      const listedMinutes = [0, 2, 4, 4, 6, 8, 10];
      const hiddenMinutes = [1, 3, 4, 5, 7, 9, 11, 12];
      const listed = listedMinutes.map((minute) =>
        walk(draftAt(userId, START_MS + minute * MINUTE_MS), TO_DELIVERED),
      );
      const hidden = hiddenMinutes.map((minute) => draftAt(userId, START_MS + minute * MINUTE_MS));
      for (const order of [...hidden, ...listed]) {
        await store.insert(order, []);
      }

      const { ids, sizes } = await readAll(store, userId, 3);

      expect(sizes).toEqual([3, 3, 1]);
      expect(ids).toEqual(newestFirst(listed));
    });

    it('son gorunenden sonra yalnizca gizli siparis kaldiysa imlec YOK (bos sayfa istenmez)', async () => {
      const store = getStore();
      const userId = newUserId();
      const listed = [3, 4].map((minute) =>
        walk(draftAt(userId, START_MS + minute * MINUTE_MS), TO_PAID),
      );
      for (const minute of [0, 1, 2]) {
        await store.insert(draftAt(userId, START_MS + minute * MINUTE_MS), []);
      }
      for (const order of listed) {
        await store.insert(order, []);
      }

      const page = await store.listByUser({ userId, pageSize: 2 });

      expect(page.orders.map((order) => order.id)).toEqual(newestFirst(listed));
      expect(page.next).toBeUndefined();
    });
  });
}
