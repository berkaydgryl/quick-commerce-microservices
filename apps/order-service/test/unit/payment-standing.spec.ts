/**
 * Odeme bekleyen siparisin odemesi nerede (T11.2 PR 2) ve supurucunun hangi
 * siparisi kapattigi: saf kurallar.
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/checkout-payment.js';
import type { PaymentStatus } from '../../src/domain/checkout-payment.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import type { Order } from '../../src/domain/order.js';
import { PAYMENT_STANDING, paymentStandingOf } from '../../src/domain/payment-standing.js';
import { hasExpiredReservation } from '../../src/domain/stock-reservation.js';
import { sampleDraftInput } from '../support/order-builders.js';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const clock = fixedClock(NOW.getTime() - 600_000);

describe('paymentStandingOf', () => {
  it.each<[PaymentStatus, (typeof PAYMENT_STANDING)[keyof typeof PAYMENT_STANDING]]>([
    [PAYMENT_STATUS.SUCCEEDED, PAYMENT_STANDING.CHARGED],
    [PAYMENT_STATUS.PENDING, PAYMENT_STANDING.IN_FLIGHT],
    [PAYMENT_STATUS.REQUIRES_3DS, PAYMENT_STANDING.NONE],
    [PAYMENT_STATUS.FAILED, PAYMENT_STANDING.NONE],
    [PAYMENT_STATUS.REFUNDED, PAYMENT_STANDING.NONE],
    [PAYMENT_STATUS.CANCELLED, PAYMENT_STANDING.NONE],
  ])('kartla %s -> %s', (status, standing) => {
    expect(paymentStandingOf({ status, method: PAYMENT_METHOD.CARD })).toBe(standing);
  });

  it('kapida odemenin PENDING i "cekim suruyor" degil: tutar teslimatta alinir', () => {
    expect(
      paymentStandingOf({
        status: PAYMENT_STATUS.PENDING,
        method: PAYMENT_METHOD.CASH_ON_DELIVERY,
      }),
    ).toBe(PAYMENT_STANDING.NONE);
  });

  it('kayit yoksa para alinmamistir', () => {
    expect(paymentStandingOf(null)).toBe(PAYMENT_STANDING.NONE);
  });
});

describe('hasExpiredReservation', () => {
  const draft = (expiresAt?: Date): Order => {
    const order = createDraftOrder(sampleDraftInput(), clock);
    return expiresAt === undefined
      ? order
      : { ...order, reservation: { reservedAt: clock.date(), expiresAt } };
  };
  const walk = (order: Order, steps: readonly OrderStatus[]): Order =>
    steps.reduce((current, status) => transitionOrder(current, status, clock), order);

  it('kilidi dolmus taslak ve odeme bekleyen siparis supurulur (bitis ani dahil)', () => {
    expect(hasExpiredReservation(draft(NOW), NOW)).toBe(true);
    const awaiting = walk(draft(new Date(NOW.getTime() - 1)), [
      ORDER_STATUS.RISK_CHECK,
      ORDER_STATUS.RESERVED,
      ORDER_STATUS.AWAITING_PAYMENT,
    ]);
    expect(hasExpiredReservation(awaiting, NOW)).toBe(true);
  });

  it('kilidi suren, kilidi olmayan (T11.2 oncesi) ve baska durumdaki siparis supurulmez', () => {
    expect(hasExpiredReservation(draft(new Date(NOW.getTime() + 1)), NOW)).toBe(false);
    expect(hasExpiredReservation(draft(), NOW)).toBe(false);
    const paid = walk(draft(new Date(NOW.getTime() - 1)), [
      ORDER_STATUS.RISK_CHECK,
      ORDER_STATUS.RESERVED,
      ORDER_STATUS.AWAITING_PAYMENT,
      ORDER_STATUS.PAID,
    ]);
    expect(hasExpiredReservation(paid, NOW)).toBe(false);
  });
});
