/**
 * Siparis ayrintisindaki 3DS durumu (#163 B1): acik / suresi doldu / hakki
 * bitti / yok. Sinirlarin iki yani (ttlSeconds 1|0, attemptsLeft 1|0); saat
 * yarisinda gelen tutarsiz govde siparisi dusurmez; kod (OTP) yok.
 */

import { CURRENCY, ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  isOpenOrderThreeDs,
  ORDER_THREE_DS_STATE,
  orderSchema,
  orderThreeDsSchema,
  orderThreeDsState,
} from '../../src/index.js';

const CHALLENGE = `tds_${'0'.repeat(31)}9`;
const OPEN = { challengeId: CHALLENGE, ttlSeconds: 45, attemptsLeft: 2 };

const money = (amountMinor: number) => ({ amountMinor, currency: CURRENCY });
const order = (fields: Record<string, unknown>) => ({
  id: `ord_${'a'.repeat(32)}`,
  status: ORDER_STATUS.AWAITING_PAYMENT,
  marketId: 'mkt_migros-jet-moda',
  lines: [],
  subtotal: money(10_000),
  deliveryFee: money(0),
  discount: money(0),
  total: money(10_000),
  address: { line: 'Moda Cad. 1', location: { lat: 40.98, lng: 29.03 } },
  timeline: [],
  createdAt: '2026-10-08T00:00:00.000Z',
  ...fields,
});

describe('orderThreeDsSchema: ornekler', () => {
  it.each([
    ['acik (gecerli)', OPEN, ORDER_THREE_DS_STATE.OPEN],
    ['suresi dolmus', { ttlSeconds: 0, attemptsLeft: 2 }, ORDER_THREE_DS_STATE.EXPIRED],
    ['hakki bitmis', { ttlSeconds: 31, attemptsLeft: 0 }, ORDER_THREE_DS_STATE.EXHAUSTED],
    [
      'ikisi birden (hak oncelikli)',
      { ttlSeconds: 0, attemptsLeft: 0 },
      ORDER_THREE_DS_STATE.EXHAUSTED,
    ],
  ])('%s', (_name, value, state) => {
    const parsed = orderThreeDsSchema.parse(value);

    expect(parsed).toEqual(value);
    expect(orderThreeDsState(parsed)).toBe(state);
    expect(isOpenOrderThreeDs(parsed)).toBe(state === ORDER_THREE_DS_STATE.OPEN);
  });
});

describe('orderThreeDsSchema: sinirlar ve saat yarisi', () => {
  it('ttlSeconds 1 acik; 0 kapali (suresi doldu) ve gelen jeton ATILIR', () => {
    expect(orderThreeDsState(orderThreeDsSchema.parse({ ...OPEN, ttlSeconds: 1 }))).toBe(
      ORDER_THREE_DS_STATE.OPEN,
    );
    const closed = orderThreeDsSchema.parse({ ...OPEN, ttlSeconds: 0 });
    expect(closed).toEqual({ ttlSeconds: 0, attemptsLeft: 2 });
    expect(orderThreeDsState(closed)).toBe(ORDER_THREE_DS_STATE.EXPIRED);
  });

  it('attemptsLeft 1 acik; 0 kapali (hakki bitti) ve gelen jeton ATILIR', () => {
    expect(orderThreeDsState(orderThreeDsSchema.parse({ ...OPEN, attemptsLeft: 1 }))).toBe(
      ORDER_THREE_DS_STATE.OPEN,
    );
    const closed = orderThreeDsSchema.parse({ ...OPEN, attemptsLeft: 0 });
    expect(closed).not.toHaveProperty('challengeId');
    expect(orderThreeDsState(closed)).toBe(ORDER_THREE_DS_STATE.EXHAUSTED);
  });

  it.each([
    ['negatif sure (jetonsuz)', { ttlSeconds: -1, attemptsLeft: 0 }],
    ['negatif hak (jetonsuz)', { ttlSeconds: 0, attemptsLeft: -1 }],
    ['kesirli hak', { ...OPEN, attemptsLeft: 1.5 }],
    ['sure eksik', { challengeId: CHALLENGE, attemptsLeft: 2 }],
  ])('reddedilir: %s', (_name, value) => {
    expect(orderThreeDsSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ['yanlis bicimli', 'chl_acik'],
    ['bos', ''],
  ])('%s jeton ACIK sayilmaz: kapali okunur, jeton atilir', (_name, challengeId) => {
    const parsed = orderThreeDsSchema.parse({ ...OPEN, challengeId });

    expect(isOpenOrderThreeDs(parsed)).toBe(false);
    expect(parsed).not.toHaveProperty('challengeId');
  });

  it('kod (OTP) alani tasinmaz: gelse de ciktida yok', () => {
    expect(orderThreeDsSchema.parse({ ...OPEN, otp: '123456' })).not.toHaveProperty('otp');
  });
});

describe('orderSchema.threeDs (#163 B1)', () => {
  it('acik, dolmus ya da tukenmis durum siparisle birlikte gelir; alan yoksa yok', () => {
    for (const threeDs of [
      OPEN,
      { ttlSeconds: 0, attemptsLeft: 1 },
      { ttlSeconds: 9, attemptsLeft: 0 },
    ]) {
      expect(orderSchema.parse(order({ threeDs })).threeDs).toEqual(threeDs);
    }
    expect(orderSchema.parse(order({})).threeDs).toBeUndefined();
  });

  it('saat yarisi: jetonsuz ama sure ve hak > 0 gelen durum KAPALI (suresi doldu) okunur, siparis dusmez', () => {
    const parsed = orderSchema.safeParse(order({ threeDs: { ttlSeconds: 1, attemptsLeft: 2 } }));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.threeDs).toEqual({ ttlSeconds: 1, attemptsLeft: 2 });
    expect(parsed.data?.threeDs && orderThreeDsState(parsed.data.threeDs)).toBe(
      ORDER_THREE_DS_STATE.EXPIRED,
    );
  });
});
