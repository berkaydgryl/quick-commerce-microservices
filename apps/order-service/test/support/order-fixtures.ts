/**
 * gRPC kapi testlerinin ortak istek ornekleri.
 */

import { MOCK_THREEDS_CODE } from '@getir/core';
import { paymentV1 } from '@getir/proto';
import type { orderV1 } from '@getir/proto';

export const IDEMPOTENCY_KEY = '4f1c3a2b-9d8e-11ee';

/**
 * Sahte catalog'a (fake-catalog-pricing.ts) gore taslagin toplami:
 * 2 x 32,50 TL sut = 65,00 ara toplam + 14,90 teslimat = 79,90 TL.
 */
export const DRAFT_TOTAL_MINOR = 7_990;

export const draftRequest: orderV1.CreateDraftOrderRequest = {
  userId: 'usr_1',
  // Kullanimdan kalkan alan (ADR-15): sunucu okumaz, yeni istemci doldurmaz.
  darkStoreId: '',
  marketId: 'mkt_migros-jet-moda',
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 2 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy, İstanbul',
  idempotencyKey: IDEMPOTENCY_KEY,
  expectedTotal: { amountMinor: DRAFT_TOTAL_MINOR, currency: 'TRY' },
  couponCode: '',
};

/** Kartla (onaylanan test karti) CreateOrder istegi; varsayilan: taslagin sahibi. */
export function createOrderRequest(
  orderId: string,
  overrides: Partial<orderV1.CreateOrderRequest> = {},
): orderV1.CreateOrderRequest {
  return {
    orderId,
    userId: draftRequest.userId,
    paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    cardToken: 'tok_test_4242',
    cardId: '',
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  };
}

/** ConfirmPayment istegi; varsayilan: taslagin sahibi, dogru mock kodu. */
export function confirmPaymentRequest(
  orderId: string,
  challengeId: string,
  overrides: Partial<orderV1.ConfirmPaymentRequest> = {},
): orderV1.ConfirmPaymentRequest {
  return {
    orderId,
    userId: draftRequest.userId,
    challengeId,
    code: MOCK_THREEDS_CODE,
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  };
}

/** CancelOrder istegi; varsayilan: taslagin sahibi, gerekcesiz, gecerli anahtarla. */
export function cancelOrderRequest(
  orderId: string,
  overrides: Partial<orderV1.CancelOrderRequest> = {},
): orderV1.CancelOrderRequest {
  return {
    orderId,
    userId: draftRequest.userId,
    reason: '',
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  };
}
