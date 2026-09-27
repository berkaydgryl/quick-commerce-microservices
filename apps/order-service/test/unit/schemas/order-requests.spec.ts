/**
 * CreateOrder, CancelOrder ve ListMyOrders istek semalari.
 * (Idempotency anahtari mutation-idempotency.spec.ts'te, tek tabloda.)
 */

import { describe, expect, it } from 'vitest';

import {
  cancelOrderRequestSchema,
  createOrderRequestSchema,
  listMyOrdersRequestSchema,
} from '../../../src/interfaces/grpc/schemas.js';
import { IDEMPOTENCY_KEY } from '../../support/order-fixtures.js';

describe('createOrderRequestSchema', () => {
  it('siparis kimligi ve kullanici zorunludur', () => {
    const request = { orderId: 'ord_1', userId: 'usr_1', idempotencyKey: IDEMPOTENCY_KEY };

    expect(() => createOrderRequestSchema.parse(request)).not.toThrow();
    expect(() => createOrderRequestSchema.parse({ ...request, orderId: '' })).toThrow();
    expect(() => createOrderRequestSchema.parse({ ...request, userId: '  ' })).toThrow();
  });
});

describe('cancelOrderRequestSchema', () => {
  it('gecerli istegi kabul eder; bos gerekce "gerekce yok" demektir', () => {
    const cancel = {
      orderId: 'ord_1',
      userId: 'usr_1',
      reason: '',
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    expect(cancelOrderRequestSchema.parse(cancel).reason).toBeUndefined();
  });
});

describe('listMyOrdersRequestSchema', () => {
  const pageSizeOf = (pageSize: number): number =>
    listMyOrdersRequestSchema.parse({ userId: 'usr_1', page: { pageSize, pageToken: '' } }).page
      .pageSize;

  it('sayfa boyutu reddedilmez, sozlesme sinirlarina oturtulur', () => {
    expect(pageSizeOf(0)).toBe(20);
    expect(pageSizeOf(-5)).toBe(20);
    expect(pageSizeOf(7)).toBe(7);
    expect(pageSizeOf(500)).toBe(100);
  });

  it('page yoksa ilk sayfa, varsayilan boyut', () => {
    expect(listMyOrdersRequestSchema.parse({ userId: 'usr_1' }).page).toEqual({
      pageSize: 20,
      pageToken: undefined,
    });
  });

  it('cozulemeyen jetonu reddeder', () => {
    expect(() =>
      listMyOrdersRequestSchema.parse({ userId: 'usr_1', page: { pageSize: 5, pageToken: 'x' } }),
    ).toThrow();
  });
});
