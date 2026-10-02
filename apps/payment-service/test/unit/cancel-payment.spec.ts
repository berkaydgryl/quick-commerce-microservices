/**
 * Iptal (T11.2 PR 3): saf karar tablosu, CancelPayment use-case'i ve proto
 * eslemesi. Bellek deposu ve mock saglayici.
 */

import { ERROR_CODES, fixedClock, ID_PREFIX, newId } from '@getir/core';
import { paymentV1 } from '@getir/proto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CANCEL_OUTCOME, createCancelPayment } from '../../src/application/cancel-payment.js';
import { CANCEL_DECISION, decideCancellation } from '../../src/domain/cancel.js';
import {
  ATTEMPT_KIND,
  ATTEMPT_OUTCOME,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from '../../src/domain/payment.js';
import type { Payment, PaymentStatus } from '../../src/domain/payment.js';
import { paymentVersionConflict } from '../../src/domain/payment-repository.js';
import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';
import { toProtoPayment } from '../../src/interfaces/grpc/mappers.js';
import { chargeOrder } from '../support/charge-order.js';

const clock = fixedClock(Date.UTC(2026, 9, 2, 12, 0, 0));

let repository: InMemoryPaymentStore;
let orderId: string;

beforeEach(() => {
  repository = new InMemoryPaymentStore();
  orderId = newId(ID_PREFIX.ORDER);
});

const cancel = () =>
  createCancelPayment({ repository, clock })({ orderId, reason: 'order_cancelled' });
const cashOnDelivery = () =>
  chargeOrder({ repository, clock, orderId, cardToken: '', cashOnDelivery: true });
const card = (cardToken: string) => chargeOrder({ repository, clock, orderId, cardToken });

/** Mock saglayicinin uretmedigi durum: kart cekimi PENDING (sonucu belli degil). */
async function cardInFlight(): Promise<Payment> {
  const cod = await cashOnDelivery();
  const store = new InMemoryPaymentStore();
  await store.insert({ ...cod, method: PAYMENT_METHOD.CARD });
  repository = store;
  return cod;
}

describe('decideCancellation', () => {
  const payment = (status: PaymentStatus, method: Payment['method'] = PAYMENT_METHOD.CARD) =>
    ({ status, method }) as Payment;

  it.each<[string, Payment, string]>([
    [
      'kapida odeme PENDING',
      payment(PAYMENT_STATUS.PENDING, PAYMENT_METHOD.CASH_ON_DELIVERY),
      CANCEL_DECISION.CANCEL,
    ],
    ['3DS bekleyen kart', payment(PAYMENT_STATUS.REQUIRES_3DS), CANCEL_DECISION.CANCEL],
    ['zaten CANCELLED', payment(PAYMENT_STATUS.CANCELLED), CANCEL_DECISION.ALREADY_CANCELLED],
    ['para alinmis', payment(PAYMENT_STATUS.SUCCEEDED), CANCEL_DECISION.NOTHING_TO_CANCEL],
    ['iade edilmis', payment(PAYMENT_STATUS.REFUNDED), CANCEL_DECISION.NOTHING_TO_CANCEL],
    ['basarisiz', payment(PAYMENT_STATUS.FAILED), CANCEL_DECISION.NOTHING_TO_CANCEL],
    ['kart cekimi PENDING', payment(PAYMENT_STATUS.PENDING), CANCEL_DECISION.IN_FLIGHT],
  ])('%s -> %s', (_name, given, decision) => {
    expect(decideCancellation(given)).toBe(decision);
  });
});

describe('CancelPayment', () => {
  it('kapida odeme PENDING -> CANCELLED: gerekce, gecmise CANCEL denemesi, surum +1', async () => {
    const before = await cashOnDelivery();

    const result = await cancel();

    expect(result.outcome).toBe(CANCEL_OUTCOME.CANCELLED);
    const stored = await repository.findByOrderId(orderId);
    expect(stored).toMatchObject({
      status: PAYMENT_STATUS.CANCELLED,
      cancelReason: 'order_cancelled',
      version: before.version + 1,
      updatedAt: clock.date(),
    });
    expect(stored?.attempts.at(-1)).toEqual({
      kind: ATTEMPT_KIND.CANCEL,
      outcome: ATTEMPT_OUTCOME.CANCELLED,
      at: clock.date(),
    });
  });

  it('3DS bekleyen kart -> CANCELLED (para hic alinmadi)', async () => {
    await card('tok_test_3184');

    await expect(cancel()).resolves.toMatchObject({ outcome: CANCEL_OUTCOME.CANCELLED });
    await expect(repository.findByOrderId(orderId)).resolves.toMatchObject({
      status: PAYMENT_STATUS.CANCELLED,
    });
  });

  it('ayni komut ikinci kez: zaten kapali, yazilmaz', async () => {
    await cashOnDelivery();
    await cancel();
    const after = await repository.findByOrderId(orderId);

    await expect(cancel()).resolves.toMatchObject({ outcome: CANCEL_OUTCOME.ALREADY_CANCELLED });
    await expect(repository.findByOrderId(orderId)).resolves.toEqual(after);
  });

  it.each([
    ['para alinmis', 'tok_test_4242', PAYMENT_STATUS.SUCCEEDED],
    ['kart reddedilmis', 'tok_test_0002', PAYMENT_STATUS.FAILED],
  ])('%s odemeye dokunulmaz (iade ayri akis)', async (_name, token, status) => {
    const before = await card(token);

    await expect(cancel()).resolves.toMatchObject({ outcome: CANCEL_OUTCOME.NOTHING_TO_CANCEL });
    await expect(repository.findByOrderId(orderId)).resolves.toMatchObject({
      status,
      version: before.version,
    });
  });

  it('hic cekim istenmemis siparis: kayit yok, hata degil', async () => {
    await expect(cancel()).resolves.toEqual({ outcome: CANCEL_OUTCOME.NO_PAYMENT });
  });

  it('kart cekimi suruyor: REQUEST_IN_PROGRESS (komut sonra yeniden denenir), kayit degismez', async () => {
    await cardInFlight();

    await expect(cancel()).rejects.toMatchObject({ code: ERROR_CODES.REQUEST_IN_PROGRESS });
    await expect(repository.findByOrderId(orderId)).resolves.toMatchObject({
      status: PAYMENT_STATUS.PENDING,
    });
  });

  it('surum cakismasinda kayit yeniden okunur ve kapatilir', async () => {
    const before = await cashOnDelivery();
    vi.spyOn(repository, 'update').mockRejectedValueOnce(
      paymentVersionConflict(orderId, before.version),
    );

    await expect(cancel()).resolves.toMatchObject({ outcome: CANCEL_OUTCOME.CANCELLED });
    await expect(repository.findByOrderId(orderId)).resolves.toMatchObject({
      status: PAYMENT_STATUS.CANCELLED,
    });
  });

  it('proto eslemesi: CANCELLED -> PAYMENT_STATUS_CANCELLED', async () => {
    await cashOnDelivery();
    const { payment } = await cancel();

    expect(payment && toProtoPayment(payment).status).toBe(
      paymentV1.PaymentStatus.PAYMENT_STATUS_CANCELLED,
    );
  });
});
