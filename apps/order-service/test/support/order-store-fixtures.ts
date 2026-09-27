/**
 * Siparis deposu sozlesme testlerinin ortak verisi.
 *
 * Mongo'da koleksiyon testler arasinda paylasilir; bu yuzden her test kendi
 * kullanicisini (benzersiz userId) acar ve yalnizca onu sorgular.
 */

import { fixedClock } from '@getir/core';

import type { OrderHistoryReader } from '../../src/domain/order-history-reader.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import type { Order } from '../../src/domain/order.js';
import { createDraftOrder } from '../../src/domain/order.js';

export type OrderStoreUnderTest = OrderRepository & OrderHistoryReader;

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
      createDraftOrder(
        {
          userId,
          marketId: 'mkt_migros-jet-moda',
          lines: [{ productId: 'prd_sut-1l', sku: 'SUT-1L', quantity: 2 }],
          deliveryLocation: { lat: 40.9885, lng: 29.0262 },
          deliveryAddress: 'Caferağa, Kadıköy',
        },
        fixedClock(epochMs),
      ),
  };
}
