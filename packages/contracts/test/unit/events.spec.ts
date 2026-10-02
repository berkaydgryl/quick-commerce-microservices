/**
 * Servisler arasi olay govdeleri (T7.4; iptal komutu T11.2 PR 3) ve paylasilan
 * kural parcalari: iade gerekcesi anahtari ve idempotency anahtari.
 */

import { ID_PREFIX, newId } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  REFUND_REASON_MAX_LENGTH,
  idempotencyKeySchema,
  paymentCancelRequestedPayloadSchema,
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

describe('paymentCancelRequestedPayloadSchema (T11.2 PR 3)', () => {
  const cancel = { orderId, reason: 'order_cancelled' };

  it('order un urettigi govdeyi kabul eder; bilinmeyen alan bozmaz (ADR-07)', () => {
    expect(paymentCancelRequestedPayloadSchema.parse(cancel)).toEqual(cancel);
    expect(paymentCancelRequestedPayloadSchema.safeParse({ ...cancel, note: 'x' }).success).toBe(
      true,
    );
  });

  it.each<[string, Record<string, unknown>]>([
    ['siparis kimligi bicimsiz', { orderId: 'ord_1' }],
    ['gerekce eksik', { reason: undefined }],
    ['gerekce metin (anahtar degil)', { reason: 'Siparis iptal edildi' }],
  ])('reddeder: %s', (_name, overrides) => {
    expect(paymentCancelRequestedPayloadSchema.safeParse({ ...cancel, ...overrides }).success).toBe(
      false,
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

  it('yalnizca harf, rakam, - ve _ kabul eder (T8.2: anahtar Redis anahtarina girer)', () => {
    expect(idempotencyKeySchema.safeParse('4f1c3a2b-9d8e-4b7a-8c6d-5e4f3a2b1c0d').success).toBe(
      true,
    );
    expect(idempotencyKeySchema.safeParse('charge-ord_0123456789abcdef').success).toBe(true);
    for (const key of [
      'iki:nokta-anahtar',
      '{usr_1}-anahtar',
      'bosluklu anahtar',
      'turkce-ş-anahtar',
    ]) {
      expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
    }
  });
});
