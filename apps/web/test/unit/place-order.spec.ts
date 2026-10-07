/**
 * Siparis akisinin adimlari (T12.4) sahte istemciyle: rezervasyon + siparis
 * (anahtarlar: rezervasyon niyet, siparis deneme), 3DS (her deneme yeni
 * anahtar; yanlis kodda kalan hak), RISK_REVIEW incelemede (N3), birakma
 * (N2 ve PM ek sart 1: yeni anahtar; 404 sessiz; 409 REQUEST_IN_PROGRESS'te
 * siparis okunur, PAID ise "paid").
 */

import type { ReserveCartRequest } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import type { ErrorCode } from '@getir/core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { HttpClient } from '../../src/shared/api/http-client';
import { createAttemptKeys } from '../../src/features/cards/services/attempt-key';
import type { PlaceOrderDraft } from '../../src/features/checkout/services/order-draft';
import {
  releaseSafely,
  startOrder,
  submitCode,
} from '../../src/features/checkout/services/place-order';
import type { OrderFlowDeps } from '../../src/features/checkout/services/place-order';

const ORDER_ID = `ord_${'c'.repeat(32)}`;
const CARD_ID = `crd_${'a'.repeat(32)}`;
const REQUEST: ReserveCartRequest = {
  marketId: 'mkt_a101',
  items: [{ productId: 'prd_sut-1l', quantity: 1 }],
  address: { line: 'Moda Cad. No:12', location: { lat: 40.98, lng: 29.02 } },
  expectedTotal: { amountMinor: 5200, currency: 'TRY' },
};
const DRAFT = (orderId: string): PlaceOrderDraft => ({
  orderId,
  payment: { method: 'CARD', cardId: CARD_ID },
  details: { note: '', doNotRingBell: false, agreementsAccepted: true },
});

type Reply = { readonly data: unknown } | { readonly error: AppError };

interface Call {
  readonly path: string;
  readonly method: string;
  readonly key: string | undefined;
  readonly body: unknown;
}

/** Sirayla yanit veren istemci; yanit sozlesme semasindan gecer (zarf gibi). */
function fakeClient(replies: Reply[]) {
  const calls: Call[] = [];
  const client: HttpClient = {
    request<T>(path: string, request: Parameters<HttpClient['request']>[1]): Promise<T> {
      const seen = request as unknown as {
        method?: string;
        idempotencyKey?: string;
        body?: unknown;
        schema: z.ZodType<T>;
      };
      calls.push({ path, method: seen.method ?? 'GET', key: seen.idempotencyKey, body: seen.body });
      const reply = replies.shift();
      if (reply === undefined) return Promise.reject(new Error('beklenmeyen istek'));
      if ('error' in reply) return Promise.reject(reply.error);
      return Promise.resolve(seen.schema.parse(reply.data));
    },
  };
  return { client, calls };
}

const error = (code: ErrorCode, details?: unknown) =>
  new AppError(code, `mesaj ${code}`, { details });

function deps(client: HttpClient, clock = { value: 1_000 }): OrderFlowDeps {
  let attempt = 0;
  let fresh = 0;
  return {
    client,
    now: () => clock.value,
    reserveKey: () => 'niyet-anahtari-1',
    orderAttempts: createAttemptKeys(() => `deneme-${(attempt += 1)}`),
    newKey: () => `yeni-${(fresh += 1)}`,
  };
}

const RESERVATION = { orderId: ORDER_ID, status: 'RESERVED', ttlSeconds: 600 };

describe('startOrder (T12.4)', () => {
  it('rezervasyon (niyet anahtari) sonra siparis (deneme anahtari); PAID', async () => {
    const { client, calls } = fakeClient([
      { data: RESERVATION },
      { data: { orderId: ORDER_ID, status: 'PAID' } },
    ]);

    await expect(startOrder(deps(client), REQUEST, DRAFT)).resolves.toEqual({
      kind: 'paid',
      orderId: ORDER_ID,
    });
    expect(calls.map((call) => [call.method, call.path, call.key])).toEqual([
      ['POST', '/v1/cart/reserve', 'niyet-anahtari-1'],
      ['POST', '/v1/orders', 'deneme-1'],
    ]);
    expect(calls[1]?.body).toEqual(DRAFT(ORDER_ID));
  });

  it('3DS: pencerenin son ani rezervasyonun sunucu ttl suresi ve kodun suresinden kisa olan', async () => {
    const clock = { value: 1_000 };
    const { client } = fakeClient([
      { data: { ...RESERVATION, ttlSeconds: 40 } },
      { data: { orderId: ORDER_ID, status: 'AWAITING_PAYMENT', threeDs: { challengeId: 'ch_1' } } },
    ]);

    await expect(startOrder(deps(client, clock), REQUEST, DRAFT)).resolves.toEqual({
      kind: 'challenge',
      orderId: ORDER_ID,
      challengeId: 'ch_1',
      deadline: 1_000 + 40_000,
    });
  });

  it('RISK_REVIEW (202): siparis olustu, incelemede (N3)', async () => {
    const { client } = fakeClient([
      { data: RESERVATION },
      { error: error(ERROR_CODES.RISK_REVIEW) },
    ]);

    await expect(startOrder(deps(client), REQUEST, DRAFT)).resolves.toEqual({
      kind: 'review',
      orderId: ORDER_ID,
    });
  });

  it('rezervasyon hatasi (PRICE_CHANGED) siparis istegi atilmadan firlar', async () => {
    const { client, calls } = fakeClient([{ error: error(ERROR_CODES.PRICE_CHANGED) }]);

    await expect(startOrder(deps(client), REQUEST, DRAFT)).rejects.toMatchObject({
      code: ERROR_CODES.PRICE_CHANGED,
    });
    expect(calls).toHaveLength(1);
  });

  it('siparisin sonucu belirsizse (503) tekrar AYNI anahtarla; reddedildiyse YENI anahtarla', async () => {
    const { client, calls } = fakeClient([
      { data: RESERVATION },
      { error: error(ERROR_CODES.SERVICE_UNAVAILABLE) },
      { data: RESERVATION },
      { error: error(ERROR_CODES.PAYMENT_DECLINED) },
      { data: RESERVATION },
      { data: { orderId: ORDER_ID, status: 'PAID' } },
    ]);
    const flow = deps(client);

    await expect(startOrder(flow, REQUEST, DRAFT)).rejects.toBeInstanceOf(AppError);
    await expect(startOrder(flow, REQUEST, DRAFT)).rejects.toBeInstanceOf(AppError);
    await startOrder(flow, REQUEST, DRAFT);
    const orderKeys = calls.filter((call) => call.path === '/v1/orders').map((call) => call.key);

    expect(orderKeys).toEqual(['deneme-1', 'deneme-1', 'deneme-2']);
  });
});

describe('submitCode (T12.4)', () => {
  it('her kod denemesi YENI anahtar; kod yalnizca govdede', async () => {
    const { client, calls } = fakeClient([
      { error: error(ERROR_CODES.THREEDS_FAILED, { attemptsLeft: 2 }) },
      { data: { orderId: ORDER_ID, status: 'PAID' } },
    ]);
    const flow = deps(client);

    await expect(submitCode(flow, ORDER_ID, 'ch_1', '000000')).resolves.toEqual({
      kind: 'retry',
      message: 'mesaj THREEDS_FAILED',
      attemptsLeft: 2,
    });
    await expect(submitCode(flow, ORDER_ID, 'ch_1', '123456')).resolves.toEqual({ kind: 'paid' });
    expect(calls.map((call) => [call.path, call.key, call.body])).toEqual([
      [`/v1/orders/${ORDER_ID}/3ds`, 'yeni-1', { challengeId: 'ch_1', otp: '000000' }],
      [`/v1/orders/${ORDER_ID}/3ds`, 'yeni-2', { challengeId: 'ch_1', otp: '123456' }],
    ]);
  });

  it('hak bittiyse (attemptsLeft 0) ya da baska hata: firlatir', async () => {
    const { client } = fakeClient([
      { error: error(ERROR_CODES.THREEDS_FAILED, { attemptsLeft: 0 }) },
      { error: error(ERROR_CODES.PAYMENT_DECLINED) },
    ]);
    const flow = deps(client);

    await expect(submitCode(flow, ORDER_ID, 'ch_1', '000000')).rejects.toMatchObject({
      code: ERROR_CODES.THREEDS_FAILED,
    });
    await expect(submitCode(flow, ORDER_ID, 'ch_1', '000000')).rejects.toMatchObject({
      code: ERROR_CODES.PAYMENT_DECLINED,
    });
  });
});

describe('releaseSafely (N2, PM ek sart 1)', () => {
  const released = { orderId: ORDER_ID, released: true, releasedAt: '2026-10-07T05:00:00.000Z' };

  it('DELETE yeni anahtarla; 200 ve 404 sessizce "released"', async () => {
    const { client, calls } = fakeClient([
      { data: released },
      { error: error(ERROR_CODES.NOT_FOUND) },
    ]);
    const flow = deps(client);

    await expect(releaseSafely(flow, ORDER_ID)).resolves.toBe('released');
    await expect(releaseSafely(flow, ORDER_ID)).resolves.toBe('released');
    expect(calls.map((call) => [call.method, call.path, call.key])).toEqual([
      ['DELETE', `/v1/cart/reserve/${ORDER_ID}`, 'yeni-1'],
      ['DELETE', `/v1/cart/reserve/${ORDER_ID}`, 'yeni-2'],
    ]);
  });

  it('409 REQUEST_IN_PROGRESS: siparis okunur; PAID ise "paid", degilse "open"', async () => {
    const money = { amountMinor: 0, currency: 'TRY' };
    const order = (status: string) => ({
      data: {
        id: ORDER_ID,
        status,
        marketId: 'mkt_a101',
        lines: [],
        subtotal: money,
        deliveryFee: money,
        discount: money,
        total: money,
        address: REQUEST.address,
        timeline: [],
        createdAt: '2026-10-07T05:00:00.000Z',
      },
    });
    const inProgress = { error: error(ERROR_CODES.REQUEST_IN_PROGRESS) };

    const paid = fakeClient([inProgress, order('PAID')]);
    await expect(releaseSafely(deps(paid.client), ORDER_ID)).resolves.toBe('paid');
    expect(paid.calls[1]).toMatchObject({ method: 'GET', path: `/v1/orders/${ORDER_ID}` });

    const open = fakeClient([inProgress, order('AWAITING_PAYMENT')]);
    await expect(releaseSafely(deps(open.client), ORDER_ID)).resolves.toBe('open');
  });

  it('siparis okunamaz ya da baska hata: "open" (hata gosterilmez)', async () => {
    const unreadable = fakeClient([
      { error: error(ERROR_CODES.REQUEST_IN_PROGRESS) },
      { error: error(ERROR_CODES.SERVICE_UNAVAILABLE) },
    ]);
    await expect(releaseSafely(deps(unreadable.client), ORDER_ID)).resolves.toBe('open');

    const other = fakeClient([{ error: error(ERROR_CODES.INTERNAL) }]);
    await expect(releaseSafely(deps(other.client), ORDER_ID)).resolves.toBe('open');
  });
});
