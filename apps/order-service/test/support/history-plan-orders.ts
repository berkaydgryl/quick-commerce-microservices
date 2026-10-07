/**
 * Gecmis sorgusunun plan testi icin veri (#101): bir kullanicinin gorunen
 * (odenmis) siparisleri gizli taslaklarla arada; en yeni siparis gizli. Tam
 * indeksten okuyan plan taslaklari da okuyup atardi; kismi indeks okumaz.
 */

import { fixedClock } from '@getir/core';

import type { OrderRepository } from '../../src/domain/order-repository.js';
import type { Order } from '../../src/domain/order.js';
import { createDraftOrder } from '../../src/domain/order.js';
import { sampleDraftInput } from './order-builders.js';
import { MINUTE_MS, START_MS, TO_PAID, walk } from './order-store-fixtures.js';

/** Gorunen ve gizli siparis sayisi (her biri). */
const ORDERS_PER_KIND = 5;

export interface HistoryPlanOrders {
  readonly userId: string;
  /** Gorunenler, gecmis sirasiyla (yeniden eskiye). */
  readonly listedNewestFirst: readonly Order[];
}

export async function insertHistoryPlanOrders(
  repository: Pick<OrderRepository, 'insert'>,
  userId: string,
): Promise<HistoryPlanOrders> {
  const listed: Order[] = [];
  for (let index = 0; index < ORDERS_PER_KIND * 2; index += 1) {
    const draft = createDraftOrder(
      sampleDraftInput({ userId }),
      fixedClock(START_MS + index * MINUTE_MS),
    );
    // Cift sira odenmis (gorunur), tek sira taslak (gizli); en yeni (9) taslak.
    const order = index % 2 === 0 ? walk(draft, TO_PAID) : draft;
    await repository.insert(order, []);
    if (index % 2 === 0) {
      listed.push(order);
    }
  }
  return { userId, listedNewestFirst: listed.reverse() };
}
