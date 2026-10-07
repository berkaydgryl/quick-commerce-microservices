/**
 * Onkosul adimi: verilen kartla bir siparisin cekimi (kendisi test edilmez).
 * Iade testleri (use-case ve T7.4 iade komutu tuketicisi) ayni yoldan odeme acar.
 */

import { silentLogger } from '@getir/core';
import type { Clock } from '@getir/core';

import { createCharge } from '../../src/application/charge.js';
import { THREEDS_CHALLENGE_TTL_MS } from '../../src/config/constants.js';
import { PAYMENT_METHOD } from '../../src/domain/payment.js';
import type { Payment } from '../../src/domain/payment.js';
import type { PaymentRepository } from '../../src/domain/payment-repository.js';
import { InMemoryCardStore } from '../../src/infrastructure/memory/in-memory-card-store.js';
import { MockPaymentProvider } from '../../src/infrastructure/mock-provider/mock-payment-provider.js';

export interface ChargeOrderOptions {
  readonly repository: PaymentRepository;
  readonly clock: Clock;
  readonly orderId: string;
  /** Test karti jetonu (README); kapida odemede yok sayilir. */
  readonly cardToken: string;
  readonly cashOnDelivery?: boolean;
}

export function chargeOrder(options: ChargeOrderOptions): Promise<Payment> {
  const charge = createCharge({
    repository: options.repository,
    cards: new InMemoryCardStore(),
    provider: new MockPaymentProvider(),
    clock: options.clock,
    challengeTtlMs: THREEDS_CHALLENGE_TTL_MS,
  });
  const cashOnDelivery = options.cashOnDelivery ?? false;
  return charge(
    {
      orderId: options.orderId,
      userId: 'usr_1',
      amount: { amountMinor: 12_990, currency: 'TRY' },
      method: cashOnDelivery ? PAYMENT_METHOD.CASH_ON_DELIVERY : PAYMENT_METHOD.CARD,
      card: cashOnDelivery ? undefined : { cardToken: options.cardToken },
      idempotencyKey: `anahtar-${options.orderId}`,
      requireThreeDs: false,
    },
    silentLogger,
  );
}
