/**
 * Refund use-case (T7.1): siparis saga'sinin telafi adimi. Bellek deposu ve
 * mock saglayiciyla; ag ve veritabani yok.
 */

import { ERROR_CODES, fixedClock, silentLogger } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCharge } from '../../src/application/charge.js';
import { createRefund } from '../../src/application/refund.js';
import { THREEDS_CHALLENGE_TTL_MS } from '../../src/config/constants.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/payment.js';
import type { Payment } from '../../src/domain/payment.js';
import { InMemoryPaymentStore } from '../../src/infrastructure/memory/in-memory-payment-store.js';
import { MockPaymentProvider } from '../../src/infrastructure/mock-provider/mock-payment-provider.js';

const clock = fixedClock(Date.UTC(2026, 8, 27, 12, 0, 0));
const REASON = 'order_cancelled';

let repository: InMemoryPaymentStore;
let refund: ReturnType<typeof createRefund>;

/** Onkosul: verilen kartla bir siparisin cekimi (kendisi test edilmez). */
function chargeOrder(orderId: string, cardToken: string, cashOnDelivery = false): Promise<Payment> {
  const charge = createCharge({
    repository,
    provider: new MockPaymentProvider(),
    clock,
    challengeTtlMs: THREEDS_CHALLENGE_TTL_MS,
  });
  return charge(
    {
      orderId,
      userId: 'usr_1',
      amount: { amountMinor: 12_990, currency: 'TRY' },
      method: cashOnDelivery ? PAYMENT_METHOD.CASH_ON_DELIVERY : PAYMENT_METHOD.CARD,
      cardToken: cashOnDelivery ? undefined : cardToken,
      idempotencyKey: `anahtar-${orderId}`,
      requireThreeDs: false,
    },
    silentLogger,
  );
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

    await expect(refund({ orderId: 'ord_1', reason: REASON })).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      details: { orderId: 'ord_1', status },
    });
    await expect(repository.findByOrderId('ord_1')).resolves.toEqual(charged);
  });

  it('odemesi olmayan siparis NOT_FOUND', async () => {
    await expect(refund({ orderId: 'ord_yok', reason: REASON })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});
