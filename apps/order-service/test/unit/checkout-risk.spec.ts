/**
 * Saga'nin risk adimi kurallari (T7.1): saf, I/O yok.
 */

import { ERROR_CODES, fixedClock, ORDER_STATUS, RISK_BANDS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { PAYMENT_METHOD } from '../../src/domain/checkout-payment.js';
import {
  applyRiskDecision,
  assertPaymentMethodAllowed,
  decideRisk,
  paymentPolicyOf,
  riskContextOf,
} from '../../src/domain/checkout-risk.js';
import { createDraftOrder } from '../../src/domain/order.js';
import { sampleDraftInput } from '../support/order-builders.js';

const clock = fixedClock(1_760_000_000_000);
const draft = () => createDraftOrder(sampleDraftInput(), clock);

describe('decideRisk (roadmap "Bantlar ve aksiyonlar")', () => {
  it.each([
    [
      RISK_BANDS.LOW,
      { kind: 'proceed', policy: { cashOnDeliveryAllowed: true, requireThreeDs: false } },
    ],
    [
      RISK_BANDS.MEDIUM,
      { kind: 'proceed', policy: { cashOnDeliveryAllowed: false, requireThreeDs: true } },
    ],
    [RISK_BANDS.HIGH, { kind: 'stop', status: ORDER_STATUS.REVIEW, code: ERROR_CODES.RISK_REVIEW }],
    [
      RISK_BANDS.CRITICAL,
      { kind: 'stop', status: ORDER_STATUS.REJECTED, code: ERROR_CODES.RISK_BLOCKED },
    ],
  ])('%s', (band, expected) => {
    expect(decideRisk(band)).toEqual(expected);
  });
});

describe('assertPaymentMethodAllowed', () => {
  it('kapida odeme yalnizca LOW bantta', () => {
    const low = decideRisk(RISK_BANDS.LOW);
    const medium = decideRisk(RISK_BANDS.MEDIUM);
    if (low.kind !== 'proceed' || medium.kind !== 'proceed') throw new Error('beklenmeyen karar');

    expect(() =>
      assertPaymentMethodAllowed('ord_1', PAYMENT_METHOD.CASH_ON_DELIVERY, low.policy),
    ).not.toThrow();
    expect(() =>
      assertPaymentMethodAllowed('ord_1', PAYMENT_METHOD.CARD, medium.policy),
    ).not.toThrow();
    expect(() =>
      assertPaymentMethodAllowed('ord_1', PAYMENT_METHOD.CASH_ON_DELIVERY, medium.policy),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.PAYMENT_METHOD_NOT_ALLOWED }) as Error);
  });
});

describe('applyRiskDecision', () => {
  it('gecen karar: RISK_CHECK (bant yazilir) -> RESERVED (PENDING_RESERVATION) -> AWAITING_PAYMENT', () => {
    const order = applyRiskDecision(draft(), RISK_BANDS.LOW, decideRisk(RISK_BANDS.LOW), clock);

    expect(order.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(order.riskBand).toBe(RISK_BANDS.LOW);
    expect(order.version).toBe(4);
    expect(order.timeline.map((entry) => entry.note)).toEqual([
      undefined,
      undefined,
      'PENDING_RESERVATION',
      undefined,
    ]);
  });

  it('durduran karar: RISK_CHECK -> REVIEW, not hata anahtari', () => {
    const order = applyRiskDecision(draft(), RISK_BANDS.HIGH, decideRisk(RISK_BANDS.HIGH), clock);

    expect(order.status).toBe(ORDER_STATUS.REVIEW);
    expect(order.timeline.at(-1)?.note).toBe('RISK_REVIEW');
  });
});

describe('paymentPolicyOf', () => {
  it('kayitli banttan politika; bandsiz eski siparis ORDER_STATE_INVALID', () => {
    const medium = applyRiskDecision(
      draft(),
      RISK_BANDS.MEDIUM,
      decideRisk(RISK_BANDS.MEDIUM),
      clock,
    );

    expect(paymentPolicyOf(medium)).toEqual({ cashOnDeliveryAllowed: false, requireThreeDs: true });
    expect(() => paymentPolicyOf(draft())).toThrow(
      expect.objectContaining({ code: ERROR_CODES.ORDER_STATE_INVALID }) as Error,
    );
  });
});

describe('riskContextOf', () => {
  it('bekleme suresi sunucuda olculur; ortalama yoksa alan HIC yazilmaz', () => {
    const order = draft();
    const context = riskContextOf(
      order,
      { deliveredCount: 0, cancelledCount: 2 },
      new Date(order.createdAt.getTime() + 30_000),
    );

    expect(context.checkoutDwellMs).toBe(30_000);
    expect(context.cancelledOrderCount).toBe(2);
    expect(context).not.toHaveProperty('userAverageBasketMinor');
  });

  it('ortalama sepet gecmisten tasinir; proto int32 ye sigmayan sure kirpilir', () => {
    const order = draft();
    const context = riskContextOf(
      order,
      { deliveredCount: 3, cancelledCount: 0, averageBasketMinor: 12_345 },
      new Date(order.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    );

    expect(context.userAverageBasketMinor).toBe(12_345);
    expect(context.checkoutDwellMs).toBe(2_147_483_647);
  });
});
