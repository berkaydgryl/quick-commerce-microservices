/**
 * Kalici iade isareti (#166): kilidi dusup parasi iade edilen siparis Gecmis
 * Siparislerim'de kalir. Iki yazim yolu:
 *   - siparisi KENDISI iptal eden kapatma (stockless-close.ts cancelLapsed):
 *     CANCELLED, iade komutu ve isaret AYNI yazimda;
 *   - siparisi BASKA yol iptal etmis, para sonra iade edilmis (refund-step.ts):
 *     iadeden sonra ayri, surum kontrollu yazim (refund-record.ts).
 */

import { AppError, ERROR_CODES, EVENTS, fixedClock, ORDER_STATUS } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { closeLapsedOrder } from '../../src/application/lapsed-order.js';
import { refundCharge } from '../../src/application/refund-step.js';
import { CHARGE, closeWithoutStock } from '../../src/application/stockless-close.js';
import { REFUND_RECORD_WRITE_ATTEMPTS } from '../../src/config/constants.js';
import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  REFUND_REASON,
} from '../../src/domain/checkout-payment.js';
import { isListedInHistory } from '../../src/domain/order-history-listing.js';
import { REFUND_MARK_REASON } from '../../src/domain/order-refund.js';
import { orderVersionConflict } from '../../src/domain/order-repository.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments } from '../support/fake-payments.js';
import { FakeStockReservations } from '../support/fake-stock-reservations.js';
import { insertAwaitingPayment } from '../support/order-builders.js';

const S = ORDER_STATUS;
const clock = fixedClock(Date.UTC(2026, 9, 8, 9, 0));

let store: InMemoryOrderStore;
let payments: FakePayments;
let lines: LogLine[];
let scope: { requestId: string; logger: ReturnType<typeof recordingLogger> };

beforeEach(() => {
  store = new InMemoryOrderStore();
  payments = new FakePayments();
  lines = [];
  scope = { requestId: 'req_iade_isareti_1', logger: recordingLogger(lines) };
});

function deps() {
  return {
    repository: store,
    payments,
    stock: new FakeStockReservations(() => clock.now()),
    outbox: store,
    clock,
  };
}

async function stored(orderId: string): Promise<Order> {
  const order = await store.findById(orderId);
  if (order === null) throw new Error(`siparis yok: ${orderId}`);
  return order;
}

/** Siparisin kayitli iade komutlari (payment.refund_requested). */
function refundCommands(orderId: string) {
  return store.recordedEvents.filter(
    (event) => event.orderId === orderId && event.topic === EVENTS.PAYMENT_REFUND_REQUESTED,
  );
}

/** Odeme bekleyen siparisi baska yol (kullanici, supurucu) iptal etti. */
async function cancelledElsewhere(): Promise<Order> {
  const awaiting = await insertAwaitingPayment(store, clock);
  const cancelled = transitionOrder(awaiting, S.CANCELLED, clock, 'USER_CANCELLED');
  await store.update(cancelled, awaiting.version, []);
  return cancelled;
}

describe('kendi kapatmasi: isaret iptalle AYNI yazimda', () => {
  it('para alinmis: CANCELLED + iade komutu + isaret tek yazim; siparis gecmiste', async () => {
    const awaiting = await insertAwaitingPayment(store, clock);

    const outcome = await closeWithoutStock(deps(), awaiting, CHARGE.TAKEN, scope);

    const closed = await stored(awaiting.id);
    expect(outcome).toEqual({ kind: 'refunded' });
    expect(closed).toMatchObject({
      status: S.CANCELLED,
      version: awaiting.version + 1,
      refund: { reason: REFUND_REASON.RESERVATION_EXPIRED, requestedAt: clock.date() },
    });
    expect(isListedInHistory(closed)).toBe(true);
    const topics = store.recordedEvents
      .filter((event) => event.orderId === awaiting.id)
      .map((event) => event.topic);
    expect(topics).toContain(EVENTS.PAYMENT_REFUND_REQUESTED);
  });

  it('para alinmamis: isaret YOK, siparis gizli', async () => {
    const awaiting = await insertAwaitingPayment(store, clock);

    await closeWithoutStock(deps(), awaiting, CHARGE.NONE, scope);

    const closed = await stored(awaiting.id);
    expect(closed.status).toBe(S.CANCELLED);
    expect(closed).not.toHaveProperty('refund');
    expect(isListedInHistory(closed)).toBe(false);
  });
});

describe('capraz yol: iadeden sonra ayri yazim', () => {
  it('dogrudan iade: iptal edilmis siparise isaret, surum +1, olay yok', async () => {
    const cancelled = await cancelledElsewhere();
    const eventsBefore = store.recordedEvents.length;

    await refundCharge(deps(), cancelled, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);

    const marked = await stored(cancelled.id);
    expect(marked).toMatchObject({
      status: S.CANCELLED,
      version: cancelled.version + 1,
      refund: { reason: REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, requestedAt: clock.date() },
    });
    expect(marked.timeline).toEqual(cancelled.timeline);
    expect(isListedInHistory(marked)).toBe(true);
    expect(store.recordedEvents).toHaveLength(eventsBefore);
  });

  it('dogrudan iade olmadi: isaret ve iade komutu TEK yazimda (#185 N5), ayri append yok', async () => {
    const cancelled = await cancelledElsewhere();
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    const append = vi.spyOn(store, 'append');

    await refundCharge(deps(), cancelled, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);

    expect(await stored(cancelled.id)).toMatchObject({
      version: cancelled.version + 1,
      refund: { reason: REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, requestedAt: clock.date() },
    });
    expect(append).not.toHaveBeenCalled();
    expect(refundCommands(cancelled.id)).toHaveLength(1);
  });

  it('dogrudan iade olmadi, bir cakisma sonra basari: komut BIR KEZ, ayri append yok', async () => {
    const cancelled = await cancelledElsewhere();
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    const update = vi
      .spyOn(store, 'update')
      .mockRejectedValueOnce(orderVersionConflict(cancelled.id, cancelled.version));
    const append = vi.spyOn(store, 'append');

    await refundCharge(deps(), cancelled, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);

    expect(update).toHaveBeenCalledTimes(2);
    expect(append).not.toHaveBeenCalled();
    expect(refundCommands(cancelled.id)).toHaveLength(1);
    expect((await stored(cancelled.id)).refund).toBeDefined();
  });

  it('dogrudan iade olmadi, siparis hala acik: yalniz komut (once para), isaret YOK', async () => {
    const awaiting = await insertAwaitingPayment(store, clock);
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    const append = vi.spyOn(store, 'append');

    await refundCharge(deps(), awaiting, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);

    expect(await stored(awaiting.id)).toEqual(awaiting);
    expect(append).toHaveBeenCalledTimes(1);
    expect(refundCommands(awaiting.id)).toHaveLength(1);
  });

  it('dogrudan iade olmadi, cakisma surerse: komut tek basina, WARN kimlik ve gerekce', async () => {
    const cancelled = await cancelledElsewhere();
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    const update = vi
      .spyOn(store, 'update')
      .mockRejectedValue(orderVersionConflict(cancelled.id, cancelled.version));
    const append = vi.spyOn(store, 'append');

    await refundCharge(deps(), cancelled, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);

    expect(update).toHaveBeenCalledTimes(REFUND_RECORD_WRITE_ATTEMPTS);
    expect(append).toHaveBeenCalledTimes(1);
    expect(refundCommands(cancelled.id)).toHaveLength(1);
    const warning = lines.find((line) => line.message.includes('iade komutu tek basina'));
    expect(warning).toMatchObject({
      level: 'warn',
      fields: { orderId: cancelled.id, reason: REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT },
    });
    expect(JSON.stringify(lines)).not.toMatch(/amount|Minor|card|tok_/i);
  });

  it('dogrudan iade olmadi, isaretli yazim dustu: komut tek basina, isaret YOK', async () => {
    const cancelled = await cancelledElsewhere();
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    vi.spyOn(store, 'update').mockRejectedValue(new Error('mongo yazamadi'));
    const append = vi.spyOn(store, 'append');

    await refundCharge(deps(), cancelled, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);

    expect(append).toHaveBeenCalledTimes(1);
    expect(refundCommands(cancelled.id)).toHaveLength(1);
    expect(await stored(cancelled.id)).not.toHaveProperty('refund');
  });

  it('iade de komut da olmadi: isaret YOK (iade edilmemis para "iade edildi" gorunmez)', async () => {
    const cancelled = await cancelledElsewhere();
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    // N5: isaretli komut tek yazimda gider; o da komut da yazilamaz.
    vi.spyOn(store, 'update').mockRejectedValue(new Error('mongo kapali'));
    vi.spyOn(store, 'append').mockRejectedValue(new Error('mongo kapali'));

    await refundCharge(deps(), cancelled, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);

    expect(await stored(cancelled.id)).not.toHaveProperty('refund');
  });

  it('siparis iptal edilmemis (hala acik): isaret YOK', async () => {
    const awaiting = await insertAwaitingPayment(store, clock);

    await refundCharge(deps(), awaiting, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);

    expect(await stored(awaiting.id)).toEqual(awaiting);
  });

  it('zaten isaretli: ikinci isaret yazilmaz', async () => {
    const cancelled = await cancelledElsewhere();
    await refundCharge(deps(), cancelled, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);
    const first = await stored(cancelled.id);

    await refundCharge(deps(), cancelled, REFUND_REASON.RESERVATION_EXPIRED, scope);

    expect(await stored(cancelled.id)).toEqual(first);
  });

  it('surum cakismasi: yeniden okunur ve yazilir', async () => {
    const cancelled = await cancelledElsewhere();
    const update = vi
      .spyOn(store, 'update')
      .mockRejectedValueOnce(orderVersionConflict(cancelled.id, cancelled.version));

    await refundCharge(deps(), cancelled, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);

    expect(update).toHaveBeenCalledTimes(2);
    expect((await stored(cancelled.id)).refund).toBeDefined();
  });

  it('cakisma surerse: iade geri alinmaz, WARN yalnizca kimlik ve gerekce tasir', async () => {
    const cancelled = await cancelledElsewhere();
    const update = vi
      .spyOn(store, 'update')
      .mockRejectedValue(orderVersionConflict(cancelled.id, cancelled.version));

    await refundCharge(deps(), cancelled, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);

    expect(update).toHaveBeenCalledTimes(REFUND_RECORD_WRITE_ATTEMPTS);
    expect(payments.refunds).toHaveLength(1);
    const warning = lines.find((line) => line.message.startsWith('iade isareti yazilamadi'));
    expect(warning).toMatchObject({
      level: 'warn',
      fields: { orderId: cancelled.id, reason: REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT },
    });
    expect(JSON.stringify(warning)).not.toMatch(/amount|Minor|card|tok_/i);
  });
});

describe('supurucu: odeme kaydi kapanista zaten iade edilmis', () => {
  it('odeme cakismasinda iade edildi, siparis acik kaldi: kapatma isaretler, komut ve iade yok', async () => {
    // Iade siparis acikken yapildi (markPaid cakismasi): o an isaret yazilamazdi.
    const awaiting = await insertAwaitingPayment(store, clock);
    payments.payments.set(awaiting.id, {
      status: PAYMENT_STATUS.REFUNDED,
      method: PAYMENT_METHOD.CARD,
    });

    const outcome = await closeLapsedOrder(deps(), awaiting, scope);

    const closed = await stored(awaiting.id);
    expect(outcome).toEqual({ kind: 'closed' });
    expect(closed.refund).toEqual({
      reason: REFUND_MARK_REASON.PAYMENT_ALREADY_REFUNDED,
      requestedAt: clock.date(),
    });
    expect(isListedInHistory(closed)).toBe(true);
    expect(payments.refunds).toHaveLength(0);
    const commands = store.recordedEvents.filter(
      (event) => event.orderId === awaiting.id && event.topic === EVENTS.PAYMENT_REFUND_REQUESTED,
    );
    expect(commands).toHaveLength(0);
  });

  it('para hic alinmamis (FAILED): isaret YOK', async () => {
    const awaiting = await insertAwaitingPayment(store, clock);
    payments.payments.set(awaiting.id, {
      status: PAYMENT_STATUS.FAILED,
      method: PAYMENT_METHOD.CARD,
    });

    await closeLapsedOrder(deps(), awaiting, scope);

    expect(await stored(awaiting.id)).not.toHaveProperty('refund');
  });
});
