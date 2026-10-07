/**
 * Siparis deposu sozlesme testlerinin ortak verisi.
 *
 * Mongo'da koleksiyon testler arasinda paylasilir; bu yuzden her test kendi
 * kullanicisini (benzersiz userId) acar ve yalnizca onu sorgular.
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';

import type { AwaitingCourierFinder } from '../../src/domain/awaiting-courier-finder.js';
import type { ExpiredOrderFinder } from '../../src/domain/expired-order-finder.js';
import type { OrderHistoryReader } from '../../src/domain/order-history-reader.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import type { Order } from '../../src/domain/order.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import { sampleDraftInput } from './order-builders.js';

export type OrderStoreUnderTest = OrderRepository &
  OrderHistoryReader &
  ExpiredOrderFinder &
  AwaitingCourierFinder;

export const START_MS = 1_760_000_000_000;
export const MINUTE_MS = 60_000;

/** Alanlar fonksiyon ALANIDIR (metot degil): sozlesmeler onlari parcalayarak alir. */
export interface OrderStoreFixtures {
  /** Suite icinde benzersiz kullanici kimligi. */
  readonly newUserId: () => string;
  /** Verilen anda olusturulmus taslak siparis. */
  readonly draftAt: (userId: string, epochMs: number) => Order;
}

export function createOrderStoreFixtures(suiteName: string): OrderStoreFixtures {
  let userCounter = 0;
  return {
    newUserId: () => {
      userCounter += 1;
      return `usr_contract-${suiteName}-${userCounter}`;
    },
    draftAt: (userId, epochMs) =>
      createDraftOrder(sampleDraftInput({ userId }), fixedClock(epochMs)),
  };
}

/** Taslaktan odemeye: risk, kilit, odeme bekleme, odendi. */
export const TO_PAID: readonly OrderStatus[] = [
  ORDER_STATUS.RISK_CHECK,
  ORDER_STATUS.RESERVED,
  ORDER_STATUS.AWAITING_PAYMENT,
  ORDER_STATUS.PAID,
];

export const TO_DELIVERED: readonly OrderStatus[] = [
  ...TO_PAID,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.ON_THE_WAY,
  ORDER_STATUS.DELIVERED,
];

/**
 * Siparisi tablodaki yoldan verilen durumlara yurutur. Saat siparisin acilis
 * ani: zaman cizelgesi olusturma anindan geriye gitmez.
 */
export function walk(order: Order, steps: readonly OrderStatus[]): Order {
  const clock = fixedClock(order.createdAt.getTime());
  return steps.reduce((current, status) => transitionOrder(current, status, clock), order);
}
