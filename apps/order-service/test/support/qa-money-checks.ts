/**
 * QA (T15.3; #122, #124): PARA VE STOK DEGISMEZI. Her kara kutu senaryosu AYNI denetimle biter
 * (expectSettled):
 *
 *   para    payment kaydinin deneme gecmisinden sayilir (ekleme-yalniz): CHARGE onayi ve 3DS kod
 *           kabulu = para alindi; REFUND = geri verildi. Durum alani degil: REFUNDED kayda ikinci
 *           bir iade yazilsa da gecmiste gorunur.
 *   siparis son durum beklenen.
 *   stok    eldeki adet beklenen kadar degisti; defterde beklenen kadar commit; bu siparisin kilidi
 *           kalmadi: (onHand - sayac) farki siparisin adedi kadar azaldi. Fark olcumu baska testin
 *           birakabilecegi kilitten bagimsizdir.
 */

import type { OrderStatus } from '@getir/core';
import { EVENTS } from '@getir/core';
import { stockAvailKey } from '@getir/redis-kit';
import { expect } from 'vitest';

import type { LedgerKind } from '../../../inventory-service/src/domain/stock-ledger.js';
import { COLLECTIONS } from '../../../inventory-service/src/infrastructure/mongo/documents.js';
import type {
  StockDocument,
  StockLedgerDocument,
} from '../../../inventory-service/src/infrastructure/mongo/documents.js';
import { ATTEMPT_KIND, ATTEMPT_OUTCOME } from '../../../payment-service/src/domain/payment.js';
import type { InventoryWorld, Shop } from './qa-payment-world.js';
import { DRAFT_QUANTITY, MARKET, SKU } from './qa-payment-world.js';

export interface Money {
  readonly charged: number;
  readonly refunded: number;
}

/** Siparisin parasi: payment kaydinin deneme gecmisinden. */
export async function moneyOf(shop: Shop, orderId: string): Promise<Money> {
  const payment = await shop.payments.findByOrderId(orderId);
  const attempts = payment?.attempts ?? [];
  const count = (kind: string, outcome: string) =>
    attempts.filter((attempt) => attempt.kind === kind && attempt.outcome === outcome).length;
  return {
    charged:
      count(ATTEMPT_KIND.CHARGE, ATTEMPT_OUTCOME.APPROVED) +
      count(ATTEMPT_KIND.THREEDS, ATTEMPT_OUTCOME.CODE_ACCEPTED),
    refunded: count(ATTEMPT_KIND.REFUND, ATTEMPT_OUTCOME.REFUNDED),
  };
}

/** Sipariste stok ve defterin hali. */
export interface StockState {
  readonly onHand: number;
  readonly counter: number;
  readonly ledger: Readonly<Partial<Record<LedgerKind, number>>>;
}

export async function stockState(world: InventoryWorld, orderId: string): Promise<StockState> {
  const { db } = world.stores.mongo;
  const document = await db
    .collection<StockDocument>(COLLECTIONS.STOCK)
    .findOne({ marketId: MARKET, sku: SKU });
  if (document === null) throw new Error('stok belgesi yok');
  const raw = await world.stores.redis.redis.get(stockAvailKey(MARKET, SKU));
  if (raw === null) throw new Error('sayac anahtari yok');
  const entries = await db
    .collection<StockLedgerDocument>(COLLECTIONS.STOCK_LEDGER)
    .find({ marketId: MARKET, orderId })
    .toArray();
  const ledger: Partial<Record<LedgerKind, number>> = {};
  for (const entry of entries) ledger[entry.kind] = (ledger[entry.kind] ?? 0) + 1;
  return { onHand: document.onHand, counter: Number(raw), ledger };
}

export interface Settlement {
  readonly status: OrderStatus;
  readonly charged: number;
  readonly refunded: number;
  /** onHand'in degisimi (kesinlesen stok eksi). */
  readonly onHandDelta: number;
  readonly committed: boolean;
}

/** Para ve stok degismezi; `before` taslak acildiktan SONRA alinir (kilit icinde). */
export async function expectSettled(
  world: InventoryWorld,
  shop: Shop,
  orderId: string,
  before: StockState,
  expected: Settlement,
): Promise<void> {
  expect(await moneyOf(shop, orderId)).toEqual({
    charged: expected.charged,
    refunded: expected.refunded,
  });
  expect((await shop.orders.findById(orderId))?.status).toBe(expected.status);
  const after = await stockState(world, orderId);
  expect(after.onHand - before.onHand).toBe(expected.onHandDelta);
  expect(after.ledger.commit ?? 0).toBe(expected.committed ? 1 : 0);
  expect(after.onHand - after.counter).toBe(before.onHand - before.counter - DRAFT_QUANTITY);
}

/** Siparisin outbox'taki iade komutu sayisi. */
export function refundCommands(shop: Shop, orderId: string): number {
  return shop.orders.recordedEvents.filter(
    (event) => event.orderId === orderId && event.topic === EVENTS.PAYMENT_REFUND_REQUESTED,
  ).length;
}
