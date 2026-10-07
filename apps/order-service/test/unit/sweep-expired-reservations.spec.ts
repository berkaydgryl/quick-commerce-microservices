/**
 * Kilidi dolan siparisleri kapatan supurucunun TEK turu (T11.2 PR 2): bellek
 * deposu, sahte payment ve inventory, sabit saat.
 */

import {
  AppError,
  ERROR_CODES,
  EVENTS,
  fixedClock,
  ORDER_STATUS,
  RISK_BANDS,
  silentLogger,
} from '@getir/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSweepExpiredReservations } from '../../src/application/sweep-expired-reservations.js';
import { startReservationSweeping } from '../../src/bootstrap.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/checkout-payment.js';
import type { PaymentMethod, PaymentStatus } from '../../src/domain/checkout-payment.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments } from '../support/fake-payments.js';
import { FakeStockReservations } from '../support/fake-stock-reservations.js';
import { insertAwaitingPayment, insertDraft } from '../support/order-builders.js';

const NOW_MS = 1_760_000_600_000;
/** Taslaklar 10 dk once acildi; kilitleri simdi ya da once doldu. */
const openedAt = fixedClock(NOW_MS - 600_000);
const BATCH = 100;

let repository: InMemoryOrderStore;
let payments: FakePayments;
let stock: FakeStockReservations;
let requestIds: number;

function sweep(batchSize = BATCH) {
  return createSweepExpiredReservations({
    expired: repository,
    repository,
    payments,
    stock,
    outbox: repository,
    clock: fixedClock(NOW_MS),
    batchSize,
    newRequestId: () => `req_supurucu_${(requestIds += 1)}`,
  })(silentLogger);
}

/** Kilidi verilen anda dolan (varsayilan: simdiden 1 ms once) kayit. */
const lock = (expiresAtMs = NOW_MS - 1) => ({
  reservation: { reservedAt: openedAt.date(), expiresAt: new Date(expiresAtMs) },
});

const expiredDraft = (expiresAtMs?: number) =>
  insertDraft(repository, openedAt, {}, lock(expiresAtMs));
const insertExpiredAwaiting = () =>
  insertAwaitingPayment(repository, openedAt, RISK_BANDS.LOW, lock());

/** Odeme bekleyen, kilidi dolmus; inventory'nin supurucusu kilidi birakmis (Commit NOT_FOUND). */
async function expiredAwaiting(): Promise<Order> {
  const order = await insertExpiredAwaiting();
  stock.expire(order.id);
  return order;
}

function paidBy(
  order: Order,
  status: PaymentStatus,
  method: PaymentMethod = PAYMENT_METHOD.CARD,
): void {
  payments.payments.set(order.id, { status, method });
}

async function stored(orderId: string): Promise<Order | null> {
  return repository.findById(orderId);
}

function topicsOf(orderId: string): string[] {
  return repository.recordedEvents
    .filter((event) => event.orderId === orderId)
    .map((event) => event.topic);
}

beforeEach(() => {
  repository = new InMemoryOrderStore();
  payments = new FakePayments();
  stock = new FakeStockReservations();
  requestIds = 0;
});

describe('SweepExpiredReservations - taslak', () => {
  it('kilidi dolan taslak CANCELLED (RESERVATION_EXPIRED), kilit birakilir; olay yazilir', async () => {
    const draft = await expiredDraft();

    const round = await sweep();

    expect(round).toMatchObject({ closedDrafts: 1, closedAwaitingPayment: 0, failed: 0 });
    const order = await stored(draft.id);
    expect(order?.status).toBe(ORDER_STATUS.CANCELLED);
    expect(order?.timeline.at(-1)?.note).toBe(ERROR_CODES.RESERVATION_EXPIRED);
    expect(stock.releases).toEqual([
      { orderId: draft.id, marketId: draft.marketId, reason: 'reservation_expired' },
    ]);
    expect(repository.recordedEvents.at(-1)).toMatchObject({
      topic: EVENTS.ORDER_STATUS_CHANGED,
      payload: { from: 'DRAFT', to: 'CANCELLED', note: 'RESERVATION_EXPIRED' },
    });
    // Taslakta odeme sorulmaz.
    expect(payments.lookups).toEqual([]);
  });

  it('sistemin iptali: risk gecmisinde kullanicinin iptali sayilmaz', async () => {
    await expiredDraft();

    await sweep();

    await expect(repository.riskHistory('usr_1')).resolves.toMatchObject({ cancelledCount: 0 });
  });
});

describe('SweepExpiredReservations - odeme bekleyen', () => {
  it('para alinmis: CANCELLED, kilit birakilir, tutar IADE edilir (reservation_expired)', async () => {
    const awaiting = await expiredAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);

    const round = await sweep();

    expect(round).toMatchObject({ closedAwaitingPayment: 1, refunded: 1 });
    expect((await stored(awaiting.id))?.status).toBe(ORDER_STATUS.CANCELLED);
    expect(payments.refunds).toEqual([
      {
        orderId: awaiting.id,
        reason: 'reservation_expired',
        idempotencyKey: `refund-${awaiting.id}`,
      },
    ]);
    expect(stock.releases.map((release) => release.orderId)).toEqual([awaiting.id]);
    // Iade komutu iptalle AYNI yazimda (T15.3): servis iptalden sonra cokse de kaybolmaz.
    expect(topicsOf(awaiting.id).slice(-3)).toEqual([
      EVENTS.ORDER_STATUS_CHANGED,
      EVENTS.PAYMENT_CANCEL_REQUESTED,
      EVENTS.PAYMENT_REFUND_REQUESTED,
    ]);
  });

  it('kart cekimi suruyor (PENDING): dokunulmaz, sonraki turda tekrar bakilir', async () => {
    const awaiting = await expiredAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.PENDING);

    const round = await sweep();

    expect(round).toMatchObject({ waiting: 1, closedAwaitingPayment: 0 });
    expect((await stored(awaiting.id))?.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(stock.releases).toEqual([]);
    expect(payments.refunds).toEqual([]);

    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);
    await expect(sweep()).resolves.toMatchObject({ refunded: 1 });
  });

  it.each([
    ['3DS bekliyor', PAYMENT_STATUS.REQUIRES_3DS, PAYMENT_METHOD.CARD],
    ['kart reddedildi', PAYMENT_STATUS.FAILED, PAYMENT_METHOD.CARD],
    ['zaten iade edildi', PAYMENT_STATUS.REFUNDED, PAYMENT_METHOD.CARD],
    ['kapida odeme', PAYMENT_STATUS.PENDING, PAYMENT_METHOD.CASH_ON_DELIVERY],
  ])('para alinmamis (%s): CANCELLED, iade YOK', async (_name, status, method) => {
    const awaiting = await expiredAwaiting();
    paidBy(awaiting, status, method);

    const round = await sweep();

    expect(round).toMatchObject({ closedAwaitingPayment: 1, refunded: 0 });
    expect((await stored(awaiting.id))?.status).toBe(ORDER_STATUS.CANCELLED);
    expect(payments.refunds).toEqual([]);
  });

  it('hic odeme kaydi yok: CANCELLED, iade yok', async () => {
    const awaiting = await expiredAwaiting();

    await expect(sweep()).resolves.toMatchObject({ closedAwaitingPayment: 1, refunded: 0 });
    expect((await stored(awaiting.id))?.status).toBe(ORDER_STATUS.CANCELLED);
  });

  it('odeme bekleyen siparis kapaninca payment a iptal komutu ayni yazimda gider (T11.2 PR 3)', async () => {
    const awaiting = await expiredAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.PENDING, PAYMENT_METHOD.CASH_ON_DELIVERY);

    await sweep();

    expect(
      repository.recordedEvents
        .filter((event) => event.orderId === awaiting.id)
        .slice(-2)
        .map((event) => event.topic),
    ).toEqual([EVENTS.ORDER_STATUS_CHANGED, EVENTS.PAYMENT_CANCEL_REQUESTED]);
  });

  it('para alinmis, stok kesinlesmis (ilk deneme PAID yazamamis): PAID; iade yok, kilit birakilmaz (bekleyen is 124)', async () => {
    const awaiting = await insertExpiredAwaiting();
    await stock.commit({ orderId: awaiting.id, marketId: awaiting.marketId });
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);

    const round = await sweep();

    expect(round).toMatchObject({ completedPaid: 1, closedAwaitingPayment: 0, refunded: 0 });
    expect((await stored(awaiting.id))?.status).toBe(ORDER_STATUS.PAID);
    expect(payments.refunds).toEqual([]);
    expect(stock.releases).toEqual([]);
    expect(topicsOf(awaiting.id)).not.toContain(EVENTS.PAYMENT_REFUND_REQUESTED);
  });

  it('para alinmis, kilit suresi gecmis ama inventory henuz birakmamis: Commit alir, PAID (bekleyen is 124)', async () => {
    const awaiting = await insertExpiredAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);

    await expect(sweep()).resolves.toMatchObject({ completedPaid: 1, refunded: 0 });
    expect((await stored(awaiting.id))?.status).toBe(ORDER_STATUS.PAID);
    expect(stock.stateOf(awaiting.id)).toBe('committed');
  });

  it('para alinmis, stok kesinlesmis, PAID i o arada baska yol yazmis: sayilmaz (skipped)', async () => {
    const awaiting = await insertExpiredAwaiting();
    await stock.commit({ orderId: awaiting.id, marketId: awaiting.marketId });
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);
    const update = repository.update.bind(repository);
    vi.spyOn(repository, 'update').mockImplementationOnce(
      async (order, expectedVersion, events) => {
        const current = await repository.findById(order.id);
        if (current === null) throw new Error('siparis yok');
        await update(transitionOrder(current, ORDER_STATUS.PAID, openedAt), current.version, []);
        return update(order, expectedVersion, events);
      },
    );

    const round = await sweep();

    expect(round).toMatchObject({ completedPaid: 0, skipped: 1, refunded: 0 });
    expect((await stored(awaiting.id))?.status).toBe(ORDER_STATUS.PAID);
    expect(payments.refunds).toEqual([]);
  });

  it('para alinmis, inventory kapali: o siparis kapatilamaz (failed); hicbir sey yazilmaz', async () => {
    const awaiting = await insertExpiredAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);
    stock.commitFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'inventory kapali');

    await expect(sweep()).resolves.toMatchObject({ failed: 1, completedPaid: 0, refunded: 0 });
    expect((await stored(awaiting.id))?.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(payments.refunds).toEqual([]);
  });

  it('dogrudan iade basarisiz: iptalle yazilan iade KOMUTU kalir, ikincisi yazilmaz; siparis kapanir', async () => {
    const awaiting = await expiredAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');

    await expect(sweep()).resolves.toMatchObject({ refunded: 1, failed: 0 });
    expect((await stored(awaiting.id))?.status).toBe(ORDER_STATUS.CANCELLED);
    const commands = repository.recordedEvents.filter(
      (event) => event.topic === EVENTS.PAYMENT_REFUND_REQUESTED,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      payload: {
        orderId: awaiting.id,
        reason: 'reservation_expired',
        idempotencyKey: `refund-${awaiting.id}`,
      },
    });
  });
});

describe('SweepExpiredReservations - kapsam ve hatalar', () => {
  it('kilidi suren, kilidi olmayan (T11.2 oncesi) ve odenmis siparise dokunulmaz', async () => {
    const live = await expiredDraft(NOW_MS + 1);
    const legacy = await insertDraft(repository, openedAt, {}, { reservation: null });

    const round = await sweep();

    expect(round).toMatchObject({ closedDrafts: 0, closedAwaitingPayment: 0 });
    expect((await stored(live.id))?.status).toBe(ORDER_STATUS.DRAFT);
    expect((await stored(legacy.id))?.status).toBe(ORDER_STATUS.DRAFT);
  });

  it('surum cakismasi, siparisi baska yol IPTAL etmis ve para alinmis: iade yine yapilir; dogrudan olmazsa komut outbox a', async () => {
    const awaiting = await expiredAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    const update = repository.update.bind(repository);
    vi.spyOn(repository, 'update').mockImplementationOnce(
      async (order, expectedVersion, events) => {
        const current = await repository.findById(order.id);
        if (current === null) throw new Error('siparis yok');
        await update(
          transitionOrder(current, ORDER_STATUS.CANCELLED, openedAt),
          current.version,
          [],
        );
        return update(order, expectedVersion, events);
      },
    );

    await expect(sweep()).resolves.toMatchObject({ skipped: 1, refunded: 0, failed: 0 });
    expect(payments.refunds.map((refund) => refund.idempotencyKey)).toEqual([
      `refund-${awaiting.id}`,
    ]);
    expect(topicsOf(awaiting.id)).toContain(EVENTS.PAYMENT_REFUND_REQUESTED);
  });

  it('surum cakismasi (siparis o arada degisti): dokunulmaz, kilit ve iade yok', async () => {
    const awaiting = await expiredAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);
    vi.spyOn(repository, 'update').mockRejectedValueOnce(
      new AppError(ERROR_CODES.CONFLICT, 'surum cakismasi'),
    );

    await expect(sweep()).resolves.toMatchObject({ skipped: 1, refunded: 0 });
    expect(stock.releases).toEqual([]);
    expect(payments.refunds).toEqual([]);
  });

  it('payment-svc kapali: o siparis kapatilamaz (failed), turdaki digerleri yine kapanir', async () => {
    await expiredAwaiting();
    const draft = await expiredDraft();
    payments.getPaymentFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');

    const round = await sweep();

    expect(round).toMatchObject({ failed: 1, closedDrafts: 1 });
    expect((await stored(draft.id))?.status).toBe(ORDER_STATUS.CANCELLED);
  });

  it('turda en fazla batchSize siparis, kilidi once dolan once', async () => {
    const later = await expiredDraft(NOW_MS - 1_000);
    const earlier = await expiredDraft(NOW_MS - 5_000);

    await expect(sweep(1)).resolves.toMatchObject({ closedDrafts: 1 });
    expect((await stored(earlier.id))?.status).toBe(ORDER_STATUS.CANCELLED);
    expect((await stored(later.id))?.status).toBe(ORDER_STATUS.DRAFT);
  });

  it('her siparis kendi istek kimligiyle: payment ve inventory ayni kimligi gorur', async () => {
    const awaiting = await expiredAwaiting();
    const getPayment = vi.spyOn(payments, 'getPayment');
    const release = vi.spyOn(stock, 'release');

    await sweep();

    const scope = expect.objectContaining({ requestId: 'req_supurucu_1' }) as unknown;
    expect(getPayment).toHaveBeenCalledWith(awaiting.id, scope);
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ orderId: awaiting.id }), scope);
  });
});

describe('startReservationSweeping (kurulum)', () => {
  it('bellek deposunda da calisir: aralik dolunca kilidi dolan taslak kapanir, kapanista durur', async () => {
    vi.useFakeTimers();
    try {
      const draft = await expiredDraft();
      const sweeper = startReservationSweeping({
        expired: repository,
        repository,
        payments,
        stock,
        outbox: repository,
        logger: silentLogger,
        clock: fixedClock(NOW_MS),
        intervalMs: 1_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await sweeper.stop();

      expect((await stored(draft.id))?.status).toBe(ORDER_STATUS.CANCELLED);
    } finally {
      vi.useRealTimers();
    }
  });
});
