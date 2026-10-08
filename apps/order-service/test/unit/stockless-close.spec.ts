/**
 * Kilitsiz kapatma cakisti, para BASKA yolda zaten iade edilmis (#185 N4):
 * kapatma siparisi yazamadi (surum degismis). Isaret yalniz siparis baska yolda
 * IPTAL edildiyse ve henuz isaretsizse yazilir; acik ya da isaretli siparise
 * dokunulmaz. Komut ve dogrudan iade yok (para zaten iade edildi).
 */

import { EVENTS, fixedClock, ORDER_STATUS } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { CHARGE, closeWithoutStock } from '../../src/application/stockless-close.js';
import { isListedInHistory } from '../../src/domain/order-history-listing.js';
import { REFUND_MARK_REASON, withRefund } from '../../src/domain/order-refund.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments } from '../support/fake-payments.js';
import { FakeStockReservations } from '../support/fake-stock-reservations.js';
import { insertAwaitingPayment } from '../support/order-builders.js';

const S = ORDER_STATUS;
const clock = fixedClock(Date.UTC(2026, 9, 8, 9, 30));

let store: InMemoryOrderStore;
let payments: FakePayments;
let lines: LogLine[];
let scope: { requestId: string; logger: ReturnType<typeof recordingLogger> };

beforeEach(() => {
  store = new InMemoryOrderStore();
  payments = new FakePayments();
  lines = [];
  scope = { requestId: 'req_kilitsiz_kapatma_1', logger: recordingLogger(lines) };
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

/** Kapatmanin elindeki eski hal; arada `change` baska bir yazim yapar. */
async function staleAfter(change: (awaiting: Order) => Order): Promise<Order> {
  const awaiting = await insertAwaitingPayment(store, clock);
  await store.update(change(awaiting), awaiting.version, []);
  return awaiting;
}

function noRefundTraffic(orderId: string): void {
  expect(payments.refunds).toHaveLength(0);
  const commands = store.recordedEvents.filter(
    (event) => event.orderId === orderId && event.topic === EVENTS.PAYMENT_REFUND_REQUESTED,
  );
  expect(commands).toHaveLength(0);
}

describe('kilitsiz kapatma cakisti, para zaten iade edilmis (CHARGE.REFUNDED)', () => {
  it('siparis baska yolda iptal edildi, isaretsiz: isaret yazilir, siparis gecmiste', async () => {
    const stale = await staleAfter((awaiting) =>
      transitionOrder(awaiting, S.CANCELLED, clock, 'USER_CANCELLED'),
    );

    const outcome = await closeWithoutStock(deps(), stale, CHARGE.REFUNDED, scope);

    const latest = await stored(stale.id);
    expect(outcome).toEqual({ kind: 'conflict' });
    expect(latest).toMatchObject({
      status: S.CANCELLED,
      refund: { reason: REFUND_MARK_REASON.PAYMENT_ALREADY_REFUNDED, requestedAt: clock.date() },
    });
    expect(isListedInHistory(latest)).toBe(true);
    noRefundTraffic(stale.id);
  });

  it('siparis hala acik (yalniz surum artti): dokunulmaz', async () => {
    const stale = await staleAfter((awaiting) => ({ ...awaiting, version: awaiting.version + 1 }));
    const before = await stored(stale.id);

    const outcome = await closeWithoutStock(deps(), stale, CHARGE.REFUNDED, scope);

    expect(outcome).toEqual({ kind: 'conflict' });
    expect(await stored(stale.id)).toEqual(before);
    noRefundTraffic(stale.id);
  });

  it('siparis zaten isaretli: ikinci isaret yazilmaz', async () => {
    const stale = await staleAfter((awaiting) =>
      withRefund(transitionOrder(awaiting, S.CANCELLED, clock, 'USER_CANCELLED'), {
        reason: REFUND_MARK_REASON.PAYMENT_ALREADY_REFUNDED,
        requestedAt: new Date(clock.now() - 60_000),
      }),
    );
    const before = await stored(stale.id);

    await closeWithoutStock(deps(), stale, CHARGE.REFUNDED, scope);

    expect(await stored(stale.id)).toEqual(before);
    noRefundTraffic(stale.id);
  });

  it('para alinmamis (CHARGE.NONE) ve baska yolda iptal: isaret YOK', async () => {
    const stale = await staleAfter((awaiting) =>
      transitionOrder(awaiting, S.CANCELLED, clock, 'USER_CANCELLED'),
    );

    await closeWithoutStock(deps(), stale, CHARGE.NONE, scope);

    expect(await stored(stale.id)).not.toHaveProperty('refund');
    noRefundTraffic(stale.id);
  });
});
