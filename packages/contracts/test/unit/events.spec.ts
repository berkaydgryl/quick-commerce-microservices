/**
 * Servisler arasi olay govdeleri (T7.4) ve paylasilan kural parcalari:
 * iade gerekcesi anahtari ve idempotency anahtari.
 */

import { ID_PREFIX, newId } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  REFUND_REASON_MAX_LENGTH,
  idempotencyKeySchema,
  refundReasonSchema,
  refundRequestedPayloadSchema,
} from '../../src/index.js';

const orderId = newId(ID_PREFIX.ORDER);
const payload = {
  orderId,
  reason: 'order_changed_during_payment',
  idempotencyKey: `refund-${orderId}`,
};

describe('refundRequestedPayloadSchema', () => {
  it('siparis saga sinin urettigi govdeyi kabul eder', () => {
    expect(refundRequestedPayloadSchema.parse(payload)).toEqual(payload);
  });

  it.each<[string, Record<string, unknown>]>([
    ['siparis kimligi bicimsiz', { orderId: 'ord_1' }],
    ['gerekce eksik', { reason: undefined }],
    ['gerekce metin (anahtar degil)', { reason: 'Siparis iptal edildi' }],
    ['anahtar eksik', { idempotencyKey: undefined }],
  ])('reddeder: %s', (_name, overrides) => {
    expect(refundRequestedPayloadSchema.safeParse({ ...payload, ...overrides }).success).toBe(
      false,
    );
  });

  it('bilinmeyen alan govdeyi bozmaz ("alan ekle" kurali, ADR-07)', () => {
    // Uretici yeni alan eklerse eski tuketici olayi reddetmemeli.
    expect(refundRequestedPayloadSchema.safeParse({ ...payload, amountMinor: 100 }).success).toBe(
      true,
    );
  });
});

describe('refundReasonSchema', () => {
  it('kucuk harf, rakam ve alt cizgi; en fazla sinir kadar', () => {
    expect(refundReasonSchema.safeParse('a'.repeat(REFUND_REASON_MAX_LENGTH)).success).toBe(true);
    expect(refundReasonSchema.safeParse('a'.repeat(REFUND_REASON_MAX_LENGTH + 1)).success).toBe(
      false,
    );
    expect(refundReasonSchema.safeParse('order-cancelled').success).toBe(false);
  });
});

describe('idempotencyKeySchema', () => {
  it('bosluk kirpilir, sinirlar core daki sabitlerdir', () => {
    expect(idempotencyKeySchema.parse(`  ${'k'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH)} `)).toBe(
      'k'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH),
    );
    expect(idempotencyKeySchema.safeParse('k'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH - 1)).success).toBe(
      false,
    );
    expect(idempotencyKeySchema.safeParse('k'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1)).success).toBe(
      false,
    );
  });
});
