/**
 * CreateDraftOrder'in stok kilidi (T11.2, draft-reservation.ts): taslak yazilmadan
 * once inventory'de kilitlenir. Stok yetmezse taslak iz olarak CANCELLED yazilir;
 * kullanicinin tek aktif kilidi (B22) eski taslaktaysa sepet yenilenir, odeme
 * asamasindaysa RESERVATION_ACTIVE. Inventory sahtedir.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateDraftOrderInput } from '../../src/application/create-draft-order.js';
import { createCreateDraftOrder } from '../../src/application/create-draft-order.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import type { Order } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FAKE_MARKET_ID, FakeCatalogPricing } from '../support/fake-catalog-pricing.js';
import { FAKE_TTL_SECONDS, FakeStockReservations } from '../support/fake-stock-reservations.js';
import { sampleDraftInput } from '../support/order-builders.js';
import { DRAFT_TOTAL_MINOR } from '../support/order-fixtures.js';

const clock = fixedClock(1_760_000_000_000);
const scope = { requestId: 'req_kilit_1', logger: silentLogger };

const input: CreateDraftOrderInput = {
  userId: 'usr_1',
  marketId: FAKE_MARKET_ID,
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 2 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy',
  expectedTotalMinor: DRAFT_TOTAL_MINOR,
};

let repository: InMemoryOrderStore;
let stock: FakeStockReservations;

function useCase() {
  return createCreateDraftOrder({
    repository,
    history: repository,
    catalog: new FakeCatalogPricing(),
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

/** Kullanicinin onceki siparisi verilen durumda ve kilidi inventory'de duruyor. */
async function givenLockedOrder(status: OrderStatus): Promise<Order> {
  const path: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
    [ORDER_STATUS.AWAITING_PAYMENT]: [
      ORDER_STATUS.RISK_CHECK,
      ORDER_STATUS.RESERVED,
      ORDER_STATUS.AWAITING_PAYMENT,
    ],
    [ORDER_STATUS.PAYMENT_FAILED]: [
      ORDER_STATUS.RISK_CHECK,
      ORDER_STATUS.RESERVED,
      ORDER_STATUS.AWAITING_PAYMENT,
      ORDER_STATUS.PAYMENT_FAILED,
    ],
    [ORDER_STATUS.REVIEW]: [ORDER_STATUS.RISK_CHECK, ORDER_STATUS.REVIEW],
  };
  const order = (path[status] ?? []).reduce(
    (current, next) => transitionOrder(current, next, clock),
    createDraftOrder(sampleDraftInput({ marketId: FAKE_MARKET_ID }), clock),
  );
  await repository.insert(order, []);
  stock.hold(order.id, order.userId, [{ sku: 'SUT-1L', quantity: 2 }], clock.date());
  return order;
}

beforeEach(() => {
  repository = new InMemoryOrderStore();
  stock = new FakeStockReservations(() => clock.now());
});

describe('CreateDraftOrder: stok kilidi (T11.2)', () => {
  it("kalemler, kullanici, market ve kilit omru inventory'ye gider; taslak kilidiyle yazilir", async () => {
    const order = await useCase()(input, scope);

    expect(stock.reserves).toEqual([
      {
        orderId: order.id,
        userId: 'usr_1',
        marketId: FAKE_MARKET_ID,
        lines: [{ sku: 'SUT-1L', quantity: 2 }],
        ttlSeconds: FAKE_TTL_SECONDS,
      },
    ]);
    expect(order.reservation).toEqual({
      reservedAt: clock.date(),
      expiresAt: new Date(clock.now() + FAKE_TTL_SECONDS * 1000),
    });
    expect((await repository.findById(order.id))?.reservation).toEqual(order.reservation);
  });

  it('stok yetmezse STOCK_INSUFFICIENT (hangi urun, kac kaldi); taslak iz olarak CANCELLED yazilir', async () => {
    stock.available.set('SUT-1L', 1);

    const error = await rejectionOf(useCase()(input, scope));

    expect(error.code).toBe(ERROR_CODES.STOCK_INSUFFICIENT);
    expect(error.details).toEqual({ sku: 'SUT-1L', requested: 2, available: 1 });
    expect(repository.size).toBe(1);
    const [event] = repository.recordedEvents;
    const trace = await repository.findById(event?.orderId ?? '');
    expect(trace?.status).toBe(ORDER_STATUS.CANCELLED);
    expect(trace?.timeline.at(-1)?.note).toBe(ERROR_CODES.STOCK_INSUFFICIENT);
    expect(trace?.reservation).toBeUndefined();
    expect(repository.recordedEvents.map((recorded) => recorded.topic)).toEqual([
      'order.created',
      'order.status_changed',
    ]);
  });

  it('eski taslak kilit tutuyorsa CART_REPLACED ile iptal edilir, kilidi birakilir, yeni sepet kilitlenir', async () => {
    const previous = await useCase()(input, scope);

    const next = await useCase()(input, scope);

    const replaced = await repository.findById(previous.id);
    expect(replaced?.status).toBe(ORDER_STATUS.CANCELLED);
    expect(replaced?.timeline.at(-1)?.note).toBe('CART_REPLACED');
    expect(stock.releases).toEqual([
      { orderId: previous.id, marketId: FAKE_MARKET_ID, reason: 'cart_replaced' },
    ]);
    expect(stock.stateOf(previous.id)).toBe('released');
    expect(stock.stateOf(next.id)).toBe('held');
    expect(stock.available.get('SUT-1L')).toBe(98);
  });

  it('onceki siparis odeme bekliyorsa RESERVATION_ACTIVE; eski siparise dokunulmaz, taslak yazilmaz', async () => {
    const pending = await givenLockedOrder(ORDER_STATUS.AWAITING_PAYMENT);

    const error = await rejectionOf(useCase()(input, scope));

    expect(error.code).toBe(ERROR_CODES.RESERVATION_ACTIVE);
    expect(error.details).toEqual({ activeOrderId: pending.id });
    expect(stock.releases).toEqual([]);
    expect((await repository.findById(pending.id))?.version).toBe(pending.version);
    expect(repository.size).toBe(1);
  });

  it.each([ORDER_STATUS.PAYMENT_FAILED, ORDER_STATUS.REVIEW])(
    'saga durmus ama kilidi birakilamamis (%s): kilit simdi birakilir, yeni sepet kilitlenir',
    async (status) => {
      const stale = await givenLockedOrder(status);

      const next = await useCase()(input, scope);

      expect(stock.releases).toEqual([
        { orderId: stale.id, marketId: FAKE_MARKET_ID, reason: 'stale_lock' },
      ]);
      expect(stock.stateOf(next.id)).toBe('held');
      expect((await repository.findById(stale.id))?.status).toBe(status);
    },
  );

  it('kilidin sahibi kayitli degilse (yazilamamis taslak) RESERVATION_ACTIVE; kilide dokunulmaz', async () => {
    stock.hold('ord_yazilamamis', 'usr_1', [{ sku: 'SUT-1L', quantity: 2 }], clock.date());

    const error = await rejectionOf(useCase()(input, scope));

    expect(error.code).toBe(ERROR_CODES.RESERVATION_ACTIVE);
    expect(stock.releases).toEqual([]);
  });

  it('eski taslak es zamanli ilerlediyse (surum cakismasi) kilidi korunur: RESERVATION_ACTIVE', async () => {
    const previous = await useCase()(input, scope);
    vi.spyOn(repository, 'update').mockRejectedValueOnce(
      new AppError(ERROR_CODES.CONFLICT, 'surum cakismasi'),
    );

    const error = await rejectionOf(useCase()(input, scope));

    expect(error.code).toBe(ERROR_CODES.RESERVATION_ACTIVE);
    expect(stock.releases).toEqual([]);
    expect(stock.stateOf(previous.id)).toBe('held');
  });

  it('taslak yazilamazsa kilit hemen birakilir (draft_not_saved); hata aynen yukari gider', async () => {
    const failure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'mongo yok');
    vi.spyOn(repository, 'insert').mockRejectedValueOnce(failure);

    const error = await rejectionOf(useCase()(input, scope));

    expect(error).toBe(failure);
    const [reserved] = stock.reserves;
    expect(stock.releases).toEqual([
      { orderId: reserved?.orderId, marketId: FAKE_MARKET_ID, reason: 'draft_not_saved' },
    ]);
    expect(stock.available.get('SUT-1L')).toBe(100);
  });

  it("inventory'ye ulasilamazsa SERVICE_UNAVAILABLE ve taslak ACILMAZ", async () => {
    stock.reserveFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory yok');

    const error = await rejectionOf(useCase()(input, scope));

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(repository.size).toBe(0);
  });

  it('fiyat tutmazsa (PRICE_CHANGED) stok HIC kilitlenmez', async () => {
    await rejectionOf(useCase()({ ...input, expectedTotalMinor: 100 }, scope));

    expect(stock.reserves).toEqual([]);
  });
});
