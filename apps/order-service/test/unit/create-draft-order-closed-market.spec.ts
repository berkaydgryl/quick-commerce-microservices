/**
 * CreateDraftOrder kapali markette (#154): taslak ACILMAZ. NO_STORE (404),
 * ayrinti YALNIZCA { reason: "STORE_CLOSED" } (market kimligi/adi yankilanmaz).
 * Denetim fiyatlamadan ve stok kilidinden ONCE: stoga dokunulmaz, teklif ve
 * gecmis okumasinin hatasindan, fiyat ve minimum sepet hatalarindan once gelir;
 * kullanicinin baska marketteki kilidi etkilenmez. Catalog ve inventory sahtedir;
 * kapali marketin teklifleri gercekteki gibi durur.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CreateDraftOrderInput } from '../../src/application/create-draft-order.js';
import { createCreateDraftOrder } from '../../src/application/create-draft-order.js';
import { ORPHAN_LOCK_MIN_AGE_SECONDS } from '../../src/config/constants.js';
import type { OrderHistoryReader } from '../../src/domain/order-history-reader.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import {
  CLOSED_MARKET_ID,
  FAKE_MARKET_ID,
  FakeCatalogPricing,
} from '../support/fake-catalog-pricing.js';
import { FAKE_TTL_SECONDS, FakeStockReservations } from '../support/fake-stock-reservations.js';
import { DRAFT_TOTAL_MINOR } from '../support/order-fixtures.js';

const clock = fixedClock(1_760_000_000_000);
const scope = { requestId: 'req_kapali_1', logger: silentLogger };

const input: CreateDraftOrderInput = {
  userId: 'usr_1',
  marketId: CLOSED_MARKET_ID,
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 2 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy',
  expectedTotalMinor: DRAFT_TOTAL_MINOR,
};

let repository: InMemoryOrderStore;
let catalog: FakeCatalogPricing;
let stock: FakeStockReservations;

function useCase(history: Pick<OrderHistoryReader, 'hasPaidOrder'> = repository) {
  return createCreateDraftOrder({
    repository,
    history,
    catalog,
    stock,
    reservationTtlSeconds: FAKE_TTL_SECONDS,
    orphanLockMinAgeSeconds: ORPHAN_LOCK_MIN_AGE_SECONDS,
    onOrphanLockReleased: () => undefined,
    clock,
  });
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}

beforeEach(() => {
  repository = new InMemoryOrderStore();
  stock = new FakeStockReservations(() => clock.now());
  catalog = new FakeCatalogPricing();
  catalog.closedMarketIds.add(CLOSED_MARKET_ID);
});

describe('CreateDraftOrder: kapali market (#154)', () => {
  it('NO_STORE; ayrinti YALNIZCA sebep; taslak, olay ve stok kilidi YOK', async () => {
    const error = await rejectionOf(useCase()(input, scope));

    expect(error.code).toBe(ERROR_CODES.NO_STORE);
    expect(error.details).toEqual({ reason: 'STORE_CLOSED' });
    expect(JSON.stringify(error.details)).not.toContain(CLOSED_MARKET_ID);
    expect(repository.size).toBe(0);
    expect(repository.recordedEvents).toEqual([]);
    expect(stock.reserves).toEqual([]);
  });

  it('fiyat degisimi (PRICE_CHANGED) ve minimum sepetten (MIN_BASKET_NOT_MET) ONCE gelir', async () => {
    const changedTotal = { ...input, marketId: FAKE_MARKET_ID, expectedTotalMinor: 100 };
    const belowMinimum = {
      ...input,
      marketId: FAKE_MARKET_ID,
      lines: [{ productId: 'prd_02', sku: 'EKMEK-1', quantity: 1 }],
      expectedTotalMinor: 1_000,
    };
    // Denetim: ayni girdiler ACIK markette gercekten bu hatalari verir.
    const whenOpen = [
      await rejectionOf(useCase()(changedTotal, scope)),
      await rejectionOf(useCase()(belowMinimum, scope)),
    ];
    catalog.closedMarketIds.add(FAKE_MARKET_ID);

    const whenClosed = [
      await rejectionOf(useCase()(changedTotal, scope)),
      await rejectionOf(useCase()(belowMinimum, scope)),
    ];

    expect(whenOpen.map((error) => error.code)).toEqual([
      ERROR_CODES.PRICE_CHANGED,
      ERROR_CODES.MIN_BASKET_NOT_MET,
    ]);
    expect(whenClosed.map((error) => error.code)).toEqual([
      ERROR_CODES.NO_STORE,
      ERROR_CODES.NO_STORE,
    ]);
    expect(stock.reserves).toEqual([]);
  });

  it('teklif ya da gecmis okumasi dusse de kapali market NO_STORE doner (503/500 degil)', async () => {
    catalog.offersFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'catalog teklifleri yok');
    const failingHistory = {
      hasPaidOrder: () =>
        Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'gecmis okunamadi')),
    };

    const offersDown = await rejectionOf(useCase()(input, scope));
    catalog.offersFailure = undefined;
    const historyDown = await rejectionOf(
      useCase(failingHistory)({ ...input, couponCode: 'ILK10' }, scope),
    );

    expect([offersDown.code, historyDown.code]).toEqual([
      ERROR_CODES.NO_STORE,
      ERROR_CODES.NO_STORE,
    ]);
    expect(stock.reserves).toEqual([]);
  });

  it('kullanicinin BASKA marketteki kilidi etkilenmez: eski taslak ve kilidi yerinde', async () => {
    const previous = await useCase()({ ...input, marketId: FAKE_MARKET_ID }, scope);

    const error = await rejectionOf(useCase()(input, scope));

    expect(error.code).toBe(ERROR_CODES.NO_STORE);
    const kept = await repository.findById(previous.id);
    expect(kept?.status).toBe(ORDER_STATUS.DRAFT);
    expect(kept?.reservation).toEqual(previous.reservation);
    expect(stock.stateOf(previous.id)).toBe('held');
    expect(stock.releases).toEqual([]);
    expect(stock.reserves.map((request) => request.orderId)).toEqual([previous.id]);
    expect(repository.size).toBe(1);
  });

  it('acik market etkilenmez: taslak acilir ve kilitlenir', async () => {
    const order = await useCase()({ ...input, marketId: FAKE_MARKET_ID }, scope);

    expect(order.status).toBe(ORDER_STATUS.DRAFT);
    expect(stock.stateOf(order.id)).toBe('held');
  });
});
