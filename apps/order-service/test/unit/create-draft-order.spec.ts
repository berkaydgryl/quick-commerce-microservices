/**
 * CreateDraftOrder use-case (T7.2): catalog'dan fiyat, sunucu hesabi, beklenen
 * toplam kontrolu ve DONDURULMUS tutarla kayit. Catalog sahtedir.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateDraftOrderInput } from '../../src/application/create-draft-order.js';
import { createCreateDraftOrder } from '../../src/application/create-draft-order.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FAKE_MARKET_ID, FakeCatalogPricing } from '../support/fake-catalog-pricing.js';
import { FAKE_TTL_SECONDS, FakeStockReservations } from '../support/fake-stock-reservations.js';
import { sampleDraftInput } from '../support/order-builders.js';
import { DRAFT_TOTAL_MINOR } from '../support/order-fixtures.js';

const clock = fixedClock(1_760_000_000_000);
const scope = { requestId: 'req_taslak_1', logger: silentLogger };

const input: CreateDraftOrderInput = {
  userId: 'usr_1',
  marketId: FAKE_MARKET_ID,
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 2 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy',
  expectedTotalMinor: DRAFT_TOTAL_MINOR,
};

let repository: InMemoryOrderStore;
let catalog: FakeCatalogPricing;
let stock: FakeStockReservations;

function useCase(history = repository) {
  return createCreateDraftOrder({
    repository,
    history,
    catalog,
    stock,
    reservationTtlSeconds: FAKE_TTL_SECONDS,
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

/** Odemesi alinmis siparis: ILK10 artik "ilk siparis" degil. */
async function givenPaidOrder(userId: string): Promise<void> {
  const steps = [
    ORDER_STATUS.RISK_CHECK,
    ORDER_STATUS.RESERVED,
    ORDER_STATUS.AWAITING_PAYMENT,
    ORDER_STATUS.PAID,
  ];
  const paid = steps.reduce(
    (order, status) => transitionOrder(order, status, clock),
    createDraftOrder(sampleDraftInput({ userId }), clock),
  );
  await repository.insert(paid, []);
}

beforeEach(() => {
  repository = new InMemoryOrderStore();
  stock = new FakeStockReservations(() => clock.now());
  catalog = new FakeCatalogPricing();
});

describe('CreateDraftOrder: sunucu tarafi fiyat', () => {
  it('tutari catalog fiyatiyla hesaplar ve taslaga DONDURUR', async () => {
    const order = await useCase()(input, scope);

    expect(order.status).toBe(ORDER_STATUS.DRAFT);
    expect(order.items.map((item) => [item.productId, item.unitPriceMinor, item.quantity])).toEqual(
      [['prd_01', 3_250, 2]],
    );
    expect(order.pricing.totalMinor).toBe(DRAFT_TOTAL_MINOR);
    await expect(repository.findById(order.id)).resolves.toEqual(order);
  });

  it('taslakla birlikte order.created yazilir (T7.3); taslak acilmazsa olay da yok', async () => {
    const order = await useCase()(input, scope);
    await rejectionOf(useCase()({ ...input, expectedTotalMinor: 100 }, scope));

    expect(repository.recordedEvents.map((event) => [event.topic, event.orderId])).toEqual([
      ['order.created', order.id],
    ]);
  });

  it('requestId catalog cagrilarina AYNEN iletilir (yeniden uretilmez)', async () => {
    await useCase()(input, scope);

    expect(catalog.requestIds).toEqual([scope.requestId, scope.requestId]);
  });

  it('istemcinin gordugu toplam tutmazsa PRICE_CHANGED ve taslak ACILMAZ', async () => {
    const error = await rejectionOf(useCase()({ ...input, expectedTotalMinor: 100 }, scope));

    expect(error.code).toBe(ERROR_CODES.PRICE_CHANGED);
    expect(error.details).toMatchObject({ totalMinor: DRAFT_TOTAL_MINOR });
    expect(repository.size).toBe(0);
  });

  it("catalog'a ulasilamazsa SERVICE_UNAVAILABLE ve taslak ACILMAZ", async () => {
    catalog.failure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'catalog yok');

    const error = await rejectionOf(useCase()(input, scope));

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(repository.size).toBe(0);
  });

  it('bilinmeyen market NOT_FOUND', async () => {
    const error = await rejectionOf(useCase()({ ...input, marketId: 'mkt_olmayan' }, scope));

    expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});

describe('CreateDraftOrder: ILK10 ve "ilk siparis mi"', () => {
  const withCoupon = { ...input, couponCode: 'ILK10', expectedTotalMinor: 7_340 };

  it('odemesi alinmis siparisi olmayan kullaniciya uygulanir; kod siparise yazilir', async () => {
    const order = await useCase()(withCoupon, scope);

    expect(order.pricing).toMatchObject({
      discountMinor: 650,
      totalMinor: 7_340,
      couponCode: 'ILK10',
    });
  });

  it('daha once odemesi alinmis siparisi olan kullaniciya COUPON_INVALID', async () => {
    await givenPaidOrder('usr_1');

    const error = await rejectionOf(useCase()(withCoupon, scope));

    expect(error.code).toBe(ERROR_CODES.COUPON_INVALID);
    expect(error.details).toMatchObject({ reason: 'NOT_FIRST_ORDER' });
  });

  it('baska kullanicinin siparisi sayilmaz', async () => {
    await givenPaidOrder('usr_baska');

    await expect(useCase()(withCoupon, scope)).resolves.toMatchObject({
      pricing: { couponCode: 'ILK10' },
    });
  });

  it('kupon yoksa gecmis HIC sorgulanmaz (gereksiz okuma yok)', async () => {
    const hasPaidOrder = vi.fn(() => Promise.resolve(false));
    const history = Object.assign(new InMemoryOrderStore(), { hasPaidOrder });

    await useCase(history)(input, scope);

    expect(hasPaidOrder).not.toHaveBeenCalled();
  });
});
