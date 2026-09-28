/**
 * Refund use-case (T7.1): siparis saga'sinin telafi adimi. Bellek deposu ve
 * mock saglayiciyla; ag ve veritabani yok.
 */

import { ERROR_CODES, fixedClock } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRefund } from '../../src/application/refund.js';
import { PAYMENT_STATUS } from '../../src/domain/payment.js';
import type { Payment } from '../../src/domain/payment.js';
import { PaymentNotRefundableError } from '../../src/domain/refund.js';
import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';
import { chargeOrder as chargeWith } from '../support/charge-order.js';

const clock = fixedClock(Date.UTC(2026, 8, 27, 12, 0, 0));
const REASON = 'order_cancelled';

let repository: InMemoryPaymentStore;
let refund: ReturnType<typeof createRefund>;

function chargeOrder(orderId: string, cardToken: string, cashOnDelivery = false): Promise<Payment> {
  return chargeWith({ repository, clock, orderId, cardToken, cashOnDelivery });
}

beforeEach(() => {
  repository = new InMemoryPaymentStore();
  refund = createRefund({ repository, clock });
});

describe('Refund', () => {
  it('tamamlanmis cekim REFUNDED olur; gerekce ve deneme kayda yazilir', async () => {
    await chargeOrder('ord_1', 'tok_test_4242');

    const { payment, alreadyRefunded } = await refund({ orderId: 'ord_1', reason: REASON });

    expect(alreadyRefunded).toBe(false);
    expect(payment.status).toBe(PAYMENT_STATUS.REFUNDED);
    expect(payment.refundReason).toBe(REASON);
    expect(payment.attempts.map((attempt) => [attempt.kind, attempt.outcome])).toEqual([
      ['CHARGE', 'APPROVED'],
      ['REFUND', 'REFUNDED'],
    ]);
    await expect(repository.findByOrderId('ord_1')).resolves.toEqual(payment);
  });

  it('tekrar istek ikinci kez iade etmez: ayni kayit, alreadyRefunded = true', async () => {
    await chargeOrder('ord_1', 'tok_test_4242');
    const first = await refund({ orderId: 'ord_1', reason: REASON });

    const second = await refund({ orderId: 'ord_1', reason: REASON });

    expect(second).toEqual({ payment: first.payment, alreadyRefunded: true });
  });

  it('es zamanli iki iade: biri iade eder, digeri hata degil "zaten iade edildi" gorur', async () => {
    await chargeOrder('ord_1', 'tok_test_4242');

    const results = await Promise.all([
      refund({ orderId: 'ord_1', reason: REASON }),
      refund({ orderId: 'ord_1', reason: REASON }),
    ]);

    expect(results.map((result) => result.alreadyRefunded).sort()).toEqual([false, true]);
    expect((await repository.findByOrderId('ord_1'))?.attempts).toHaveLength(2);
  });

  it.each([
    ['reddedilmis cekim', 'tok_test_0002', false, PAYMENT_STATUS.FAILED],
    ['3DS bekleyen cekim', 'tok_test_3184', false, PAYMENT_STATUS.REQUIRES_3DS],
    ['kapida odeme (tahsil edilmedi)', '', true, PAYMENT_STATUS.PENDING],
  ])('%s iade edilemez: CONFLICT, kayit degismez', async (_name, cardToken, cod, status) => {
    const charged = await chargeOrder('ord_1', cardToken, cod);

    const failure = refund({ orderId: 'ord_1', reason: REASON });

    await expect(failure).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { orderId: 'ord_1', status },
    });
    // Surum cakismasindan ayri tip: iade komutu tuketicisi bunu kalici hata sayar (T7.4).
    await expect(failure).rejects.toBeInstanceOf(PaymentNotRefundableError);
    await expect(repository.findByOrderId('ord_1')).resolves.toEqual(charged);
  });

  it('odemesi olmayan siparis NOT_FOUND', async () => {
    await expect(refund({ orderId: 'ord_yok', reason: REASON })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});
