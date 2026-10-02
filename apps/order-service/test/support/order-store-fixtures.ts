/**
 * Siparis deposu sozlesme testlerinin ortak verisi.
 *
 * Mongo'da koleksiyon testler arasinda paylasilir; bu yuzden her test kendi
 * kullanicisini (benzersiz userId) acar ve yalnizca onu sorgular.
 */

import { fixedClock } from '@getir/core';

import type { ExpiredOrderFinder } from '../../src/domain/expired-order-finder.js';
import type { OrderHistoryReader } from '../../src/domain/order-history-reader.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import type { Order } from '../../src/domain/order.js';
import { createDraftOrder } from '../../src/domain/order.js';
import { sampleDraftInput } from './order-builders.js';

export type OrderStoreUnderTest = OrderRepository & OrderHistoryReader & ExpiredOrderFinder;

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
