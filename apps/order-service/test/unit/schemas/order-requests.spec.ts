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
  listMyOrdersRequestSchema,
} from '../../../src/interfaces/grpc/schemas.js';
import { createOrderRequestSchema } from '../../../src/interfaces/grpc/create-order-schema.js';
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
      signals: {},
      details: { note: '', doNotRingBell: false },
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
    // Kart kurali payment-svc'ninkiyle ayni (T12.4): card_id ya da card_token, TAM biri.
    [{ cardToken: '' }, 'cardId', 'kartli odemede card_id ya da card_token zorunlu'],
    [
      { paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY },
      'cardToken',
      'kapida odemede kart bos olmali',
    ],
  ])('gecersiz odeme %o: tek hata, alaniyla', (overrides, field, message) => {
    expect(issuesOf(overrides)).toEqual([[field, message]]);
  });

  describe('signals (T7.5, gateway doldurur)', () => {
    const signalsOf = (signals: orderV1.CreateOrderRequest['signals']) =>
      createOrderRequestSchema.parse({ ...request, signals }).signals;

    it('mesaj gelmezse sinyal yok: bos nesne', () => {
      expect(signalsOf(undefined)).toEqual({});
    });

    it('bos metin ve 0 "yok" demektir: alan tasinmaz (risk sozlesmesi)', () => {
      const parsed = signalsOf({
        ipAddress: '',
        ipCity: '  ',
        deviceId: '',
        accountsOnDevice: 0,
        previousIpAddress: '',
        sessionLocation: undefined,
        accountCreatedAt: undefined,
      });

      expect(parsed).toEqual({});
    });

    it('dolu sinyaller oldugu gibi okunur (IP kirpilir)', () => {
      const accountCreatedAt = new Date('2026-09-01T00:00:00Z');

      expect(
        signalsOf({
          ipAddress: ' 85.105.1.20 ',
          ipCity: 'Istanbul',
          deviceId: 'dev_1',
          accountsOnDevice: 2,
          previousIpAddress: '85.105.1.19',
          sessionLocation: { lat: 41, lng: 29 },
          accountCreatedAt,
        }),
      ).toEqual({
        ipAddress: '85.105.1.20',
        ipCity: 'Istanbul',
        deviceId: 'dev_1',
        accountsOnDevice: 2,
        previousIpAddress: '85.105.1.19',
        sessionLocation: { lat: 41, lng: 29 },
        accountCreatedAt,
      });
    });

    it('sinirsiz metin ve gecersiz konum reddedilir', () => {
      const empty = {
        ipAddress: '',
        ipCity: '',
        deviceId: '',
        accountsOnDevice: 0,
        previousIpAddress: '',
      };
      const rejects = (signals: orderV1.CreateOrderRequest['signals']) =>
        !createOrderRequestSchema.safeParse({ ...request, signals }).success;

      expect(rejects({ ...empty, deviceId: 'd'.repeat(129) })).toBe(true);
      expect(rejects({ ...empty, accountsOnDevice: -1 })).toBe(true);
      expect(rejects({ ...empty, sessionLocation: { lat: 95, lng: 29 } })).toBe(true);
    });
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
