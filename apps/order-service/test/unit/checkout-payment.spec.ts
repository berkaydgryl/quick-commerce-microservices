/**
 * Saga'nin odeme adimi kurallari (T7.1): odeme sonucu -> siparisin sonraki adimi.
 */

import { ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  chargeIdempotencyKey,
  decidePayment,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  refundIdempotencyKey,
} from '../../src/domain/checkout-payment.js';

const CARD = PAYMENT_METHOD.CARD;

describe('decidePayment', () => {
  it('onay PAID; kapida odemenin PENDING i de PAID (not CASH_ON_DELIVERY)', () => {
    expect(decidePayment('ord_1', CARD, { status: PAYMENT_STATUS.SUCCEEDED })).toEqual({
      kind: 'paid',
    });
    expect(
      decidePayment('ord_1', PAYMENT_METHOD.CASH_ON_DELIVERY, { status: PAYMENT_STATUS.PENDING }),
    ).toEqual({ kind: 'paid', note: 'CASH_ON_DELIVERY' });
  });

  it('kartli PENDING: cekim suruyor, REQUEST_IN_PROGRESS (siparis ilerletilmez)', () => {
    expect(() => decidePayment('ord_1', CARD, { status: PAYMENT_STATUS.PENDING })).toThrow(
      expect.objectContaining({ code: ERROR_CODES.REQUEST_IN_PROGRESS }) as Error,
    );
  });

  it('3DS: jetonla bekleme; jetonsuz 3DS cevabi INTERNAL', () => {
    expect(
      decidePayment('ord_1', CARD, { status: PAYMENT_STATUS.REQUIRES_3DS, challengeId: 'tds_1' }),
    ).toEqual({ kind: 'awaiting-3ds', challengeId: 'tds_1' });
    expect(() => decidePayment('ord_1', CARD, { status: PAYMENT_STATUS.REQUIRES_3DS })).toThrow(
      expect.objectContaining({ code: ERROR_CODES.INTERNAL }) as Error,
    );
  });

  it('basarisiz: payment-svc nin nedeni; neden yoksa PAYMENT_DECLINED', () => {
    expect(
      decidePayment('ord_1', CARD, {
        status: PAYMENT_STATUS.FAILED,
        failureCode: ERROR_CODES.SERVICE_UNAVAILABLE,
      }),
    ).toEqual({ kind: 'failed', code: ERROR_CODES.SERVICE_UNAVAILABLE });
    expect(decidePayment('ord_1', CARD, { status: PAYMENT_STATUS.FAILED })).toEqual({
      kind: 'failed',
      code: ERROR_CODES.PAYMENT_DECLINED,
    });
  });

  it('iade edilmis odeme odeme adiminda olamaz: INTERNAL', () => {
    expect(() => decidePayment('ord_1', CARD, { status: PAYMENT_STATUS.REFUNDED })).toThrow(
      expect.objectContaining({ code: ERROR_CODES.INTERNAL }) as Error,
    );
  });
});

describe('idempotency anahtarlari siparisten turetilir', () => {
  it('ayni siparis hep ayni anahtar; payment-svc sinirlari icinde (8-128, izinli karakterler)', () => {
    const orderId = 'ord_db77f4c0e24f49919cc1d78a649c9c94';

    expect(chargeIdempotencyKey(orderId)).toBe(chargeIdempotencyKey(orderId));
    for (const key of [chargeIdempotencyKey(orderId), refundIdempotencyKey(orderId)]) {
      expect(key).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    }
  });
});
