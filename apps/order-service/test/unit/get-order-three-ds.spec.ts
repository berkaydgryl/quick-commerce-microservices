/**
 * Use-case: GetOrder'in 3DS adimi (#163 B1). Bellek deposu, sahte payment,
 * kaydeden gunlukcu. Kurallar: yalnizca AWAITING_PAYMENT'ta payment'a gidilir;
 * sahiplik ONCE denetlenir; kaydin sahibi farkliysa ya da payment hata verirse
 * siparis yine doner (3DS yok + WARN); jeton hicbir gunluk satirina girmez.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { createGetOrder } from '../../src/application/get-order.js';
import type { GetOrder } from '../../src/application/get-order.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import type { ThreeDsStatus } from '../../src/domain/payment-three-ds.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments } from '../support/fake-payments.js';
import { insertAwaitingPayment, insertDraft, insertPaid } from '../support/order-builders.js';

const clock = fixedClock(Date.UTC(2026, 9, 8, 9, 0));
const OWNER = 'usr_1';
const CHALLENGE_ID = 'tds_0009d7cd0e904b689aabcacf4458d520';

const OPEN: ThreeDsStatus = {
  challengeId: CHALLENGE_ID,
  expiresAt: new Date(clock.now() + 42_000),
  attemptsLeft: 2,
};

let repository: InMemoryOrderStore;
let payments: FakePayments;
let lines: LogLine[];
let scope: { requestId: string; logger: ReturnType<typeof recordingLogger> };
let getOrder: GetOrder;

beforeEach(() => {
  repository = new InMemoryOrderStore();
  payments = new FakePayments();
  lines = [];
  scope = { requestId: 'req_3ds_surdurme_1', logger: recordingLogger(lines) };
  getOrder = createGetOrder({ repository, payments });
});

const warnings = () => lines.filter((line) => line.level === 'warn');

async function awaitingWith(threeDs: ThreeDsStatus | undefined, userId = OWNER): Promise<Order> {
  const awaiting = await insertAwaitingPayment(repository, clock);
  payments.threeDs.set(awaiting.id, threeDs === undefined ? { userId } : { userId, threeDs });
  return awaiting;
}

/** AWAITING_PAYMENT'tan gecilen son durum (odeme basarisiz, iptal). */
async function closedFromAwaiting(status: 'PAYMENT_FAILED' | 'CANCELLED'): Promise<Order> {
  const awaiting = await insertAwaitingPayment(repository, clock);
  const closed = transitionOrder(awaiting, ORDER_STATUS[status], clock);
  await repository.update(closed, awaiting.version, []);
  return closed;
}

describe('GetOrder 3DS durumu (#163 B1)', () => {
  it('odeme bekleyen siparise sahibin dogrulamasi OLDUGU GIBI eklenir; uyari yok', async () => {
    const awaiting = await awaitingWith(OPEN);

    const view = await getOrder({ orderId: awaiting.id, userId: OWNER }, scope);

    expect(view.order.id).toBe(awaiting.id);
    expect(view.threeDs).toEqual(OPEN);
    expect(payments.threeDsLookups).toEqual([awaiting.id]);
    expect(warnings()).toEqual([]);
  });

  it('kapali dogrulama (jetonsuz, hakki bitmis) de yorumlanmadan tasinir: karar gateway in', async () => {
    const exhausted: ThreeDsStatus = { ...OPEN, challengeId: '', attemptsLeft: 0 };
    const awaiting = await awaitingWith(exhausted);

    const view = await getOrder({ orderId: awaiting.id, userId: OWNER }, scope);

    expect(view.threeDs).toEqual(exhausted);
  });

  it('dogrulamasi olmayan kayit ve kaydi olmayan siparis: alan yok, uyari yok', async () => {
    const withoutChallenge = await awaitingWith(undefined);
    const withoutRecord = await insertAwaitingPayment(repository, clock);

    for (const { id } of [withoutChallenge, withoutRecord]) {
      const view = await getOrder({ orderId: id, userId: OWNER }, scope);
      expect(view).not.toHaveProperty('threeDs');
    }
    expect(payments.threeDsLookups).toEqual([withoutChallenge.id, withoutRecord.id]);
    expect(warnings()).toEqual([]);
  });

  it('odeme kaydinin sahibi baskasiysa 3DS YOK + WARN (yalnizca siparis kimligi)', async () => {
    const awaiting = await awaitingWith(OPEN, 'usr_2');

    const view = await getOrder({ orderId: awaiting.id, userId: OWNER }, scope);

    expect(view).not.toHaveProperty('threeDs');
    expect(view.order.id).toBe(awaiting.id);
    expect(warnings()).toEqual([
      {
        level: 'warn',
        fields: { orderId: awaiting.id },
        message: 'odeme kaydinin sahibi siparisin sahibi degil; 3DS durumu verilmedi',
      },
    ]);
  });

  it.each([
    [
      'ulasilamaz',
      new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali'),
      'SERVICE_UNAVAILABLE',
    ],
    ['sozlesme bozuk', AppError.internal('bitissiz 3DS'), 'INTERNAL'],
    ['beklenmeyen hata', new TypeError('tanimsiz'), 'INTERNAL'],
  ])('payment %s: siparis DUSMEZ, 3DS yok + WARN (hata kodu)', async (_case, failure, code) => {
    const awaiting = await awaitingWith(OPEN);
    payments.getThreeDsFailure = failure;

    const view = await getOrder({ orderId: awaiting.id, userId: OWNER }, scope);

    expect(view.order.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(view).not.toHaveProperty('threeDs');
    expect(warnings()).toEqual([
      {
        level: 'warn',
        fields: { orderId: awaiting.id, code },
        message: '3DS durumu okunamadi; siparis 3DS durumsuz donuyor',
      },
    ]);
  });

  it.each([
    ['DRAFT', () => insertDraft(repository, clock)],
    ['PAID', () => insertPaid(repository, clock)],
    ['PAYMENT_FAILED', () => closedFromAwaiting('PAYMENT_FAILED')],
    ['CANCELLED', () => closedFromAwaiting('CANCELLED')],
  ])('%s sipariste payment a HIC gidilmez (kayitta dogrulama olsa da)', async (status, build) => {
    const order = await build();
    payments.threeDs.set(order.id, { userId: OWNER, threeDs: OPEN });

    const view = await getOrder({ orderId: order.id, userId: OWNER }, scope);

    expect(view.order.status).toBe(status);
    expect(view).not.toHaveProperty('threeDs');
    expect(payments.threeDsLookups).toEqual([]);
  });

  it('baskasinin siparisi NOT_FOUND ve payment a gidilmez (sahiplik ONCE)', async () => {
    const awaiting = await awaitingWith(OPEN, 'usr_2');

    await expect(getOrder({ orderId: awaiting.id, userId: 'usr_2' }, scope)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      details: { orderId: awaiting.id },
    });
    expect(payments.threeDsLookups).toEqual([]);
  });

  it('jeton (challengeId) hicbir gunluk satirina girmez; hata mesaji tasisa bile', async () => {
    const shown = await awaitingWith(OPEN);
    const foreign = await awaitingWith(OPEN, 'usr_2');
    const failing = await awaitingWith(OPEN);
    await getOrder({ orderId: shown.id, userId: OWNER }, scope);
    await getOrder({ orderId: foreign.id, userId: OWNER }, scope);
    payments.getThreeDsFailure = new AppError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      `payment kapali (${CHALLENGE_ID})`,
      { details: { challengeId: CHALLENGE_ID } },
    );
    await getOrder({ orderId: failing.id, userId: OWNER }, scope);

    expect(warnings()).toHaveLength(2);
    expect(JSON.stringify(lines)).not.toContain(CHALLENGE_ID);
    expect(JSON.stringify(lines)).not.toContain('tds_');
  });

  it('GetOrder YAZMAZ: siparis belgesi ve olaylar (outbox) degismez; jeton yalnizca cevapta', async () => {
    const awaiting = await awaitingWith(OPEN);
    const stored = await repository.findById(awaiting.id);
    const events = repository.recordedEvents.length;

    const view = await getOrder({ orderId: awaiting.id, userId: OWNER }, scope);

    expect(view.threeDs?.challengeId).toBe(CHALLENGE_ID);
    const after = await repository.findById(awaiting.id);
    expect(after).toEqual(stored);
    expect(repository.recordedEvents).toHaveLength(events);
    expect(JSON.stringify([after, repository.recordedEvents])).not.toContain('tds_');
  });
});
