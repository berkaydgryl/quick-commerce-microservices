/**
 * Kilidi dusmus sipariste odeme (T15.3; bekleyen is 122): odeme ya da 3DS
 * denemesinde stok kilidi dusmus bulunursa siparis, supurucuyle AYNI tabloya gore
 * kapatilir. Onceki hata: odeme kaydina bakilmadan CANCELLED yaziliyordu; ilk
 * denemenin cekimi basarili olup cevabi kaybolduysa para iadesiz kaliyordu.
 *
 *   DRAFT            -> odeme olamaz; kayda bakilmaz, iptal (degismedi)
 *   para alinmis     -> CANCELLED + iade KOMUTU ayni yazimda, kilit birakilir, dogrudan iade
 *   cekim suruyor    -> HICBIR SEY yazilmaz; REQUEST_IN_PROGRESS (supurucu karar verir)
 *   para alinmamis   -> CANCELLED, kilit birakilir (REQUIRES_3DS dahil; degismedi)
 *   payment kapali   -> HICBIR SEY yazilmaz; SERVICE_UNAVAILABLE
 *   kapatma cakisti  -> baska yol iptal ettiyse 410, siparis ilerlediyse 409
 */

import { AppError, ERROR_CODES, EVENTS, fixedClock, ORDER_STATUS, RISK_BANDS } from '@getir/core';
import type { OrderStatus, RiskBand } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createConfirmPayment } from '../../src/application/confirm-payment.js';
import { createCreateOrder } from '../../src/application/create-order.js';
import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  REFUND_REASON,
  refundIdempotencyKey,
} from '../../src/domain/checkout-payment.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeRiskAssessment } from '../support/fake-risk-assessment.js';
import { FakeStockReservations, TEST_LOCK_POLICY } from '../support/fake-stock-reservations.js';
import { insertAwaitingPayment, insertDraft } from '../support/order-builders.js';

const DRAFT_AT_MS = 1_760_000_000_000;
const SECOND = 1_000;
const byCard = { method: PAYMENT_METHOD.CARD, cardToken: TEST_CARD.APPROVED } as const;

let clock: ReturnType<typeof fixedClock>;
let repository: InMemoryOrderStore;
let payments: FakePayments;
let stock: FakeStockReservations;
let logLines: LogLine[];
let scope: { requestId: string; logger: ReturnType<typeof recordingLogger> };
let create: ReturnType<typeof createCreateOrder>;
let confirm: ReturnType<typeof createConfirmPayment>;

beforeEach(() => {
  clock = fixedClock(DRAFT_AT_MS);
  repository = new InMemoryOrderStore();
  payments = new FakePayments();
  stock = new FakeStockReservations(() => clock.now());
  logLines = [];
  scope = { requestId: 'req_dusen_kilit_1', logger: recordingLogger(logLines) };
  const deps = {
    repository,
    history: repository,
    risk: new FakeRiskAssessment(),
    payments,
    stock,
    outbox: repository,
    clock,
    lockPolicy: TEST_LOCK_POLICY,
  };
  create = createCreateOrder(deps);
  confirm = createConfirmPayment(deps);
});

function expiryOf(order: Order): Date {
  const expiresAt = order.reservation?.expiresAt;
  if (expiresAt === undefined) throw new Error('siparisin kilidi yok');
  return expiresAt;
}

async function stored(orderId: string): Promise<Order> {
  const order = await repository.findById(orderId);
  if (order === null) throw new Error(`siparis yok: ${orderId}`);
  return order;
}

/** Odeme bekleyen siparis; stok kilidi inventory'de DUSMUS, kalan sure pencerenin altinda. */
async function lapsedAwaiting(band: RiskBand = RISK_BANDS.LOW): Promise<Order> {
  const awaiting = await insertAwaitingPayment(repository, clock, band);
  clock.set(expiryOf(awaiting).getTime() - 30 * SECOND);
  stock.expire(awaiting.id);
  return awaiting;
}

function paidBy(order: Order, status: (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS]): void {
  payments.payments.set(order.id, { status, method: PAYMENT_METHOD.CARD });
}

/** Kapatma yazimindan hemen once baska bir yol siparisi `to` durumuna yazar. */
function raceClosingWith(to: OrderStatus): void {
  const update = repository.update.bind(repository);
  vi.spyOn(repository, 'update').mockImplementationOnce(async (order, expectedVersion, events) => {
    const current = await stored(order.id);
    await update(transitionOrder(current, to, clock), current.version, []);
    return update(order, expectedVersion, events);
  });
}

const place = (order: Order) =>
  create({ orderId: order.id, userId: order.userId, ...byCard }, scope);

describe('odeme denemesinde kilit dusmus (bekleyen is 122)', () => {
  it('ilk denemenin cekimi basarili ama cevabi kaybolmus: CANCELLED, kilit birakilir, tutar IADE edilir', async () => {
    const awaiting = await lapsedAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);
    const writes = vi.spyOn(repository, 'update');

    await expect(place(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { orderId: awaiting.id, status: ORDER_STATUS.CANCELLED, refunded: true },
    });

    expect((await stored(awaiting.id)).status).toBe(ORDER_STATUS.CANCELLED);
    // Iade komutu iptalle AYNI yazimda: servis iptalden sonra cokse de kaybolmaz.
    const cancelWrite = writes.mock.calls.find(
      ([order]) => order.status === ORDER_STATUS.CANCELLED,
    );
    expect(cancelWrite?.[2].map((event) => event.topic)).toEqual([
      EVENTS.ORDER_STATUS_CHANGED,
      EVENTS.PAYMENT_CANCEL_REQUESTED,
      EVENTS.PAYMENT_REFUND_REQUESTED,
    ]);
    expect(cancelWrite?.[2].at(-1)?.payload).toEqual({
      orderId: awaiting.id,
      reason: REFUND_REASON.RESERVATION_EXPIRED,
      idempotencyKey: refundIdempotencyKey(awaiting.id),
    });
    expect(payments.refunds).toEqual([
      {
        orderId: awaiting.id,
        reason: REFUND_REASON.RESERVATION_EXPIRED,
        idempotencyKey: refundIdempotencyKey(awaiting.id),
      },
    ]);
    expect(stock.releases.map((release) => release.orderId)).toEqual([awaiting.id]);
    expect(payments.charges).toEqual([]);
  });

  it('kart cekimi suruyor (PENDING): HICBIR SEY yazilmaz, iade ve birakma yok; REQUEST_IN_PROGRESS', async () => {
    const awaiting = await lapsedAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.PENDING);

    await expect(place(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.REQUEST_IN_PROGRESS,
      details: { orderId: awaiting.id, paymentStatus: PAYMENT_STATUS.PENDING },
    });

    const after = await stored(awaiting.id);
    expect(after.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(after.version).toBe(awaiting.version);
    expect(payments.refunds).toEqual([]);
    expect(stock.releases).toEqual([]);
  });

  it('para alinmamis (kayit yok): CANCELLED, kilit birakilir, iade yok (degismedi)', async () => {
    const awaiting = await lapsedAwaiting();

    await expect(place(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { refunded: false },
    });

    expect((await stored(awaiting.id)).status).toBe(ORDER_STATUS.CANCELLED);
    expect(payments.refunds).toEqual([]);
    expect(stock.releases.map((release) => release.orderId)).toEqual([awaiting.id]);
    expect(
      repository.recordedEvents.some((event) => event.topic === EVENTS.PAYMENT_REFUND_REQUESTED),
    ).toBe(false);
  });

  it('dogrudan iade yapilamazsa iptalle yazilan komut kalir, ikincisi yazilmaz; siparis yine CANCELLED', async () => {
    const awaiting = await lapsedAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');

    await expect(place(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { refunded: true },
    });

    expect((await stored(awaiting.id)).status).toBe(ORDER_STATUS.CANCELLED);
    const commands = repository.recordedEvents.filter(
      (event) => event.topic === EVENTS.PAYMENT_REFUND_REQUESTED,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      payload: { orderId: awaiting.id, reason: REFUND_REASON.RESERVATION_EXPIRED },
    });
  });

  it('payment-svc kapali: HICBIR SEY yazilmaz, kilit birakilmaz; SERVICE_UNAVAILABLE', async () => {
    const awaiting = await lapsedAwaiting();
    payments.getPaymentFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');

    await expect(place(awaiting)).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });

    const after = await stored(awaiting.id);
    expect(after.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(after.version).toBe(awaiting.version);
    expect(stock.releases).toEqual([]);
    expect(payments.refunds).toEqual([]);
  });

  it('kapatma cakisti, baska yol iptal etmis: 410; kaybeden iade etmez, kilidi birakmaz', async () => {
    const awaiting = await lapsedAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);
    raceClosingWith(ORDER_STATUS.CANCELLED);

    const error: unknown = await place(awaiting).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { orderId: awaiting.id, status: ORDER_STATUS.CANCELLED },
    });
    expect((error as AppError).details).not.toHaveProperty('refunded');
    expect(payments.refunds).toEqual([]);
    expect(stock.releases).toEqual([]);
  });

  it('kapatma cakisti, siparis ilerlemis (PAID): 409; dokunulmaz', async () => {
    const awaiting = await lapsedAwaiting();
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);
    raceClosingWith(ORDER_STATUS.PAID);

    await expect(place(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { orderId: awaiting.id },
    });

    expect((await stored(awaiting.id)).status).toBe(ORDER_STATUS.PAID);
    expect(payments.refunds).toEqual([]);
    expect(stock.releases).toEqual([]);
  });

  it('kilidi dusmus TASLAK: odeme kaydina BAKILMAZ (odeme olamaz), iptal (degismedi)', async () => {
    const draft = await insertDraft(repository, clock);
    clock.set(expiryOf(draft).getTime() + SECOND);

    await expect(place(draft)).rejects.toMatchObject({ code: ERROR_CODES.RESERVATION_EXPIRED });

    expect(payments.lookups).toEqual([]);
    expect((await stored(draft.id)).status).toBe(ORDER_STATUS.CANCELLED);
  });
});

describe('3DS onayinda kilit dusmus (bekleyen is 122)', () => {
  const confirmOf = (order: Order) =>
    confirm(
      { orderId: order.id, userId: order.userId, challengeId: 'tds_1', code: '123456' },
      scope,
    );

  it('3DS onayi payment ta basarili ama cevabi kaybolmus: CANCELLED ve IADE', async () => {
    const awaiting = await lapsedAwaiting(RISK_BANDS.MEDIUM);
    paidBy(awaiting, PAYMENT_STATUS.SUCCEEDED);

    await expect(confirmOf(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
      details: { refunded: true },
    });

    expect((await stored(awaiting.id)).status).toBe(ORDER_STATUS.CANCELLED);
    expect(payments.refunds.map((refund) => refund.orderId)).toEqual([awaiting.id]);
    expect(payments.confirmations).toEqual([]);
  });

  it('kart cekimi suruyor (PENDING): kod payment a gitmez, HICBIR SEY yazilmaz; REQUEST_IN_PROGRESS', async () => {
    const awaiting = await lapsedAwaiting(RISK_BANDS.MEDIUM);
    paidBy(awaiting, PAYMENT_STATUS.PENDING);

    await expect(confirmOf(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.REQUEST_IN_PROGRESS,
    });

    const after = await stored(awaiting.id);
    expect(after.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(after.version).toBe(awaiting.version);
    expect(payments.confirmations).toEqual([]);
    expect(payments.refunds).toEqual([]);
  });

  it('3DS bekleyen odeme (REQUIRES_3DS): para alinmamis sayilir; CANCELLED, iade yok (degismedi)', async () => {
    const awaiting = await lapsedAwaiting(RISK_BANDS.MEDIUM);
    paidBy(awaiting, PAYMENT_STATUS.REQUIRES_3DS);

    await expect(confirmOf(awaiting)).rejects.toMatchObject({
      code: ERROR_CODES.RESERVATION_EXPIRED,
    });

    expect((await stored(awaiting.id)).status).toBe(ORDER_STATUS.CANCELLED);
    expect(payments.refunds).toEqual([]);
  });
});
