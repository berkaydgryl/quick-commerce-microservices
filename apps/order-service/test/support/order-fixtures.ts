/**
 * gRPC kapi testlerinin ortak istek ornekleri.
 */

import type { orderV1 } from '@getir/proto';

export const IDEMPOTENCY_KEY = '4f1c3a2b-9d8e-11ee';

export const draftRequest: orderV1.CreateDraftOrderRequest = {
  userId: 'usr_1',
  // Kullanimdan kalkan alan (ADR-15): sunucu okumaz, yeni istemci doldurmaz.
  darkStoreId: '',
  marketId: 'mkt_migros-jet-moda',
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 2 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy, İstanbul',
  idempotencyKey: IDEMPOTENCY_KEY,
};

/** Kapida odemeyle CreateOrder istegi; kullanici verilmezse taslagin sahibi. */
export function createOrderRequest(
  orderId: string,
  userId = draftRequest.userId,
): orderV1.CreateOrderRequest {
  return { orderId, userId, paymentMethod: 0, cardToken: '', idempotencyKey: IDEMPOTENCY_KEY };
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
