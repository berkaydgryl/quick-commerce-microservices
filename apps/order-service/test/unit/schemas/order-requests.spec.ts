/**
 * CreateOrder, ConfirmPayment, CancelOrder ve ListMyOrders istek semalari.
 * (Idempotency anahtari mutation-idempotency.spec.ts'te, tek tabloda.)
 */

import type { orderV1 } from '@getir/proto';
import { paymentV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import {
  cancelOrderRequestSchema,
  confirmPaymentRequestSchema,
  createOrderRequestSchema,
  listMyOrdersRequestSchema,
} from '../../../src/interfaces/grpc/schemas.js';
import {
  confirmPaymentRequest,
  createOrderRequest,
  IDEMPOTENCY_KEY,
} from '../../support/order-fixtures.js';

describe('createOrderRequestSchema', () => {
  const request = createOrderRequest('ord_1');
  const issuesOf = (overrides: Partial<orderV1.CreateOrderRequest>) =>
    (createOrderRequestSchema.safeParse({ ...request, ...overrides }).error?.issues ?? []).map(
      (issue) => [issue.path.join('.'), issue.message],
    );

  it('siparis kimligi ve kullanici zorunludur', () => {
    expect(() => createOrderRequestSchema.parse(request)).not.toThrow();
    expect(() => createOrderRequestSchema.parse({ ...request, orderId: '' })).toThrow();
    expect(() => createOrderRequestSchema.parse({ ...request, userId: '  ' })).toThrow();
  });

  it('kartli odeme: yontem domain sozlugune, jeton kirpilarak (T7.1)', () => {
    expect(createOrderRequestSchema.parse({ ...request, cardToken: ' tok_test_4242 ' })).toEqual({
      orderId: 'ord_1',
      userId: 'usr_1',
      paymentMethod: 'CARD',
      cardToken: 'tok_test_4242',
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it('kapida odeme: jeton alani HIC yazilmaz', () => {
    const parsed = createOrderRequestSchema.parse({
      ...request,
      paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
      cardToken: '',
    });

    expect(parsed.paymentMethod).toBe('CASH_ON_DELIVERY');
    expect(parsed).not.toHaveProperty('cardToken');
  });

  it.each([
    [
      { paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_UNSPECIFIED },
      'paymentMethod',
      'odeme yontemi zorunlu',
    ],
    [{ cardToken: '' }, 'cardToken', 'kartli odemede zorunlu'],
    [
      { paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY },
      'cardToken',
      'kapida odemede bos olmali',
    ],
  ])('gecersiz odeme %o: tek hata, alaniyla', (overrides, field, message) => {
    expect(issuesOf(overrides)).toEqual([[field, message]]);
  });
});

describe('confirmPaymentRequestSchema (T7.1)', () => {
  it('kod 6 hane (sozlesmedeki OTP kurali), bosluklar kirpilir', () => {
    expect(
      confirmPaymentRequestSchema.parse(
        confirmPaymentRequest('ord_1', 'tds_1', { code: ' 123456 ' }),
      ).code,
    ).toBe('123456');
    expect(
      confirmPaymentRequestSchema.safeParse(
        confirmPaymentRequest('ord_1', 'tds_1', { code: '12345' }),
      ).success,
    ).toBe(false);
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
