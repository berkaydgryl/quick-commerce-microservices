/**
 * QA (T15.2): order'in gRPC cagrilari, verilen sunucu uzerinden. Tek kopyali dunya
 * (qa-payment-world.ts, Shop) ve iki kopyali kume (qa-order-cluster.ts) ayni istekleri kullanir.
 * Istekler order-fixtures.ts'ten: taslak 2 x SUT-1L, sabit idempotency anahtari (her siparis
 * yeni kullaniciyla acilir: ayni kullanicinin ikinci taslagi ilkini iptal eder, B22 CART_REPLACED).
 */

import { orderV1, paymentV1 } from '@getir/proto';
import type { CallResult, TestGrpcServer } from '@getir/service-kit/testing';

import { TEST_CARD } from './fake-payments.js';
import {
  cancelOrderRequest,
  confirmPaymentRequest,
  createOrderRequest,
  draftRequest,
} from './order-fixtures.js';

const orderService = orderV1.OrderServiceService;

/** Mock saglayicinin reddettigi 3DS kodu (dogrusu MOCK_THREEDS_CODE). */
export const WRONG_CODE = '000000';

let users = 0;

/** Her cagri yeni kullanici: B22 (kullanici basina tek kilit; yeni taslak oncekini iptal eder) karismasin. */
export function nextUser(): string {
  users += 1;
  return `usr_${(0x12200 + users).toString(16).padStart(32, '0')}`;
}

export interface OrderCalls {
  /** Taslak acar; siparis kimligi. Acilamazsa firlatir. */
  draft(userId: string): Promise<string>;
  /** Taslak dener; sonuc (hata dahil) oldugu gibi (or. RESERVATION_ACTIVE olcumu). */
  tryDraft(userId: string): Promise<CallResult<orderV1.CreateDraftOrderResponse>>;
  /** Kartla (eski test jetonu yolu) CreateOrder; `overrides` istegin diger alanlari (or. gateway sinyalleri). */
  createOrder(
    orderId: string,
    userId: string,
    cardToken?: string,
    overrides?: Partial<orderV1.CreateOrderRequest>,
  ): Promise<CallResult<orderV1.CreateOrderResponse>>;
  /** Kapida odeme (nakit) ile CreateOrder. */
  payOnDelivery(orderId: string, userId: string): Promise<CallResult<orderV1.CreateOrderResponse>>;
  /** 3DS onayi; varsayilan dogru mock kodu. */
  confirm(
    orderId: string,
    userId: string,
    challengeId: string,
    code?: string,
  ): Promise<CallResult<orderV1.ConfirmPaymentResponse>>;
  cancel(orderId: string, userId: string): Promise<CallResult<orderV1.CancelOrderResponse>>;
  /** ListMyOrders; jeton bos = ilk sayfa. */
  list(
    userId: string,
    pageSize: number,
    pageToken?: string,
  ): Promise<CallResult<orderV1.ListMyOrdersResponse>>;
  get(orderId: string, userId: string): Promise<CallResult<orderV1.GetOrderResponse>>;
}

export function orderCalls(server: TestGrpcServer): OrderCalls {
  return {
    draft: async (userId) => {
      const { response, error } = await server.call(orderService.createDraftOrder, {
        ...draftRequest,
        userId,
      });
      if (response === undefined) throw new Error(`taslak acilamadi: ${error?.message ?? ''}`);
      return response.orderId;
    },
    tryDraft: (userId) => server.call(orderService.createDraftOrder, { ...draftRequest, userId }),
    createOrder: (orderId, userId, cardToken = TEST_CARD.APPROVED, overrides = {}) =>
      server.call(
        orderService.createOrder,
        createOrderRequest(orderId, {
          userId,
          cardToken,
          paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
          ...overrides,
        }),
      ),
    payOnDelivery: (orderId, userId) =>
      server.call(
        orderService.createOrder,
        createOrderRequest(orderId, {
          userId,
          cardToken: '',
          paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
          onDelivery: orderV1.DeliveryPaymentKind.DELIVERY_PAYMENT_KIND_CASH,
        }),
      ),
    confirm: (orderId, userId, challengeId, code) =>
      server.call(
        orderService.confirmPayment,
        confirmPaymentRequest(orderId, challengeId, {
          userId,
          ...(code === undefined ? {} : { code }),
        }),
      ),
    cancel: (orderId, userId) =>
      server.call(orderService.cancelOrder, cancelOrderRequest(orderId, { userId })),
    list: (userId, pageSize, pageToken = '') =>
      server.call(orderService.listMyOrders, { userId, page: { pageSize, pageToken } }),
    get: (orderId, userId) => server.call(orderService.getOrder, { orderId, userId }),
  };
}
