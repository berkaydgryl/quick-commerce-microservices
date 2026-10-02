/**
 * Iade komutu tuketicisi (T7.4): payment.refund_requested -> Refund use-case.
 * Bellek deposu ve mock saglayici; Redis yok (olay hattinin kendisi
 * @getir/event-bus testlerinde, uctan uca yol test/integration'da).
 */

import { AppError, EVENTS, fixedClock, ID_PREFIX, newId, silentLogger } from '@getir/core';
import type { LogFields, Logger } from '@getir/core';
import type { EventEnvelope, EventHandler, EventSubscriber } from '@getir/event-bus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRefund } from '../../src/application/refund.js';
import { subscribePaymentEvents } from '../../src/bootstrap.js';
import { PAYMENT_STATUS } from '../../src/domain/payment.js';
import type { PaymentRepository } from '../../src/domain/payment-repository.js';
import { paymentVersionConflict } from '../../src/domain/payment-repository.js';
import { PaymentNotRefundableError } from '../../src/domain/refund.js';
import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';
import { createRefundRequestedHandler } from '../../src/interfaces/workers/refund-requested.js';
import { chargeOrder } from '../support/charge-order.js';
import { refundCommand as commandFor } from '../support/refund-command.js';

const clock = fixedClock(Date.UTC(2026, 8, 28, 12, 0, 0));
const APPROVED_CARD = 'tok_test_4242';
const delivery = { attempt: 1, logger: silentLogger };

let repository: InMemoryPaymentStore;
let orderId: string;

beforeEach(() => {
  repository = new InMemoryPaymentStore();
  orderId = newId(ID_PREFIX.ORDER);
});

function handlerOn(store: PaymentRepository): EventHandler {
  return createRefundRequestedHandler({ refund: createRefund({ repository: store, clock }) });
}

function refundCommand(override: Record<string, unknown> = {}): EventEnvelope {
  return commandFor(orderId, clock.date(), override);
}

const charge = (cardToken = APPROVED_CARD, cashOnDelivery = false) =>
  chargeOrder({ repository, clock, orderId, cardToken, cashOnDelivery });

describe('iade komutu: islenir', () => {
  it('tamamlanmis cekim iade edilir, gerekce kayda yazilir; olay onaylanir', async () => {
    await charge();

    const outcome = await handlerOn(repository)(refundCommand(), delivery);

    expect(outcome).toEqual({ kind: 'handled' });
    await expect(repository.findByOrderId(orderId)).resolves.toMatchObject({
      status: PAYMENT_STATUS.REFUNDED,
      refundReason: 'order_changed_during_payment',
    });
  });

  it('ayni komut ikinci kez gelirse para iki kez geri verilmez (en az bir kez teslim)', async () => {
    await charge();
    const command = refundCommand();

    await handlerOn(repository)(command, delivery);
    const second = await handlerOn(repository)(command, delivery);

    expect(second).toEqual({ kind: 'handled' });
    expect((await repository.findByOrderId(orderId))?.attempts).toHaveLength(2);
  });

  it('gunluge siparis kimligi ve zaten-iade bilgisi yazilir', async () => {
    await charge();
    const info = vi.fn<(fields: LogFields, message: string) => void>();
    const logger: Logger = { ...silentLogger, info };
    const handler = handlerOn(repository);

    await handler(refundCommand(), { attempt: 1, logger });
    await handler(refundCommand(), { attempt: 1, logger });

    expect(info.mock.calls).toEqual([
      [{ orderId, alreadyRefunded: false }, 'iade komutu: odeme iade edildi'],
      [{ orderId, alreadyRefunded: true }, 'iade komutu: odeme zaten iade edilmisti'],
    ]);
  });
});

describe('iade komutu: reddedilir (tekrar denemek sonucu degistirmez)', () => {
  it('odemesi olmayan siparis', async () => {
    const outcome = await handlerOn(repository)(refundCommand(), delivery);

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'iade yapilamaz' });
    expect(outcome).toHaveProperty('cause.code', 'NOT_FOUND');
  });

  it.each([
    ['reddedilmis cekim', 'tok_test_0002', false],
    ['3DS bekleyen cekim', 'tok_test_3184', false],
    ['kapida odeme (tahsil edilmedi)', '', true],
  ])('%s: iade edilemez, kayit degismez', async (_name, cardToken, cashOnDelivery) => {
    const charged = await charge(cardToken, cashOnDelivery);

    const outcome = await handlerOn(repository)(refundCommand(), delivery);

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'iade yapilamaz' });
    expect(outcome).toHaveProperty('cause', expect.any(PaymentNotRefundableError));
    await expect(repository.findByOrderId(orderId)).resolves.toEqual(charged);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['gerekce anahtar degil', { reason: 'Siparis iptal' }, 'reason'],
    ['anahtar eksik', { idempotencyKey: undefined }, 'idempotencyKey'],
    ['siparis kimligi bicimsiz', { orderId: 'ord_1' }, 'orderId'],
  ])('sozlesmeye uymayan govde (%s): odemeye dokunulmaz', async (_name, payload, field) => {
    const charged = await charge();

    const outcome = await handlerOn(repository)(refundCommand(payload), delivery);

    expect(outcome).toMatchObject({ kind: 'rejected' });
    expect(outcome).toHaveProperty('reason', expect.stringContaining(field));
    await expect(repository.findByOrderId(orderId)).resolves.toEqual(charged);
  });
});

describe('iade komutu: gecici hata firlatilir (olay yeniden teslim edilir)', () => {
  it('veritabani okunamadi', async () => {
    const down: PaymentRepository = {
      insert: () => Promise.reject(AppError.internal('mongo kapali')),
      update: () => Promise.reject(AppError.internal('mongo kapali')),
      findByOrderId: () => Promise.reject(AppError.internal('mongo kapali')),
      findByIdempotencyKey: () => Promise.reject(AppError.internal('mongo kapali')),
    };

    await expect(handlerOn(down)(refundCommand(), delivery)).rejects.toThrow('mongo kapali');
  });

  it('surum cakismasi (odeme ayni anda baska istekle degisti): kalici sayilmaz', async () => {
    await charge();
    const conflicting: PaymentRepository = {
      insert: (payment) => repository.insert(payment),
      update: () => Promise.reject(paymentVersionConflict(orderId, 1)),
      findByOrderId: (id) => repository.findByOrderId(id),
      findByIdempotencyKey: (key) => repository.findByIdempotencyKey(key),
    };

    const failure = handlerOn(conflicting)(refundCommand(), delivery);

    await expect(failure).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(failure).rejects.not.toBeInstanceOf(PaymentNotRefundableError);
  });
});

describe('subscribePaymentEvents', () => {
  it('iade ve iptal komutu "payment" grubunda dinlenir ve verilen depoya baglanir', async () => {
    const subscriptions: { topic: string; group: string; handler: EventHandler }[] = [];
    const subscriber: EventSubscriber = {
      subscribe: (topic, group, handler) => {
        subscriptions.push({ topic, group, handler });
      },
    };
    await charge();

    subscribePaymentEvents(subscriber, { repository, clock });

    expect(subscriptions.map(({ topic, group }) => [topic, group])).toEqual([
      [EVENTS.PAYMENT_REFUND_REQUESTED, 'payment'],
      [EVENTS.PAYMENT_CANCEL_REQUESTED, 'payment'],
    ]);
    await subscriptions[0]?.handler(refundCommand(), delivery);
    await expect(repository.findByOrderId(orderId)).resolves.toMatchObject({
      status: PAYMENT_STATUS.REFUNDED,
    });
  });
});
