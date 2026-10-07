/**
 * QA (T15.2): order'in gRPC cagrilari, verilen sunucu uzerinden. Tek kopyali dunya
 * (qa-payment-world.ts, Shop) ve iki kopyali kume (qa-order-cluster.ts) ayni istekleri kullanir.
 * Istekler order-fixtures.ts'ten: taslak 2 x SUT-1L, sabit idempotency anahtari (her siparis
 * yeni kullaniciyla acilir; ayni kullanicinin ikinci taslagi ilkini dondurur).
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

/** Her cagri yeni kullanici: B22 kullanici kilidi ve ayni kullanicinin taslak tekrari karismasin. */
export function nextUser(): string {
  users += 1;
  return `usr_${(0x12200 + users).toString(16).padStart(32, '0')}`;
}

export interface OrderCalls {
  /** Taslak acar; siparis kimligi. Acilamazsa firlatir. */
  draft(userId: string): Promise<string>;
  /** Kartla (eski test jetonu yolu) CreateOrder. */
  createOrder(
    orderId: string,
    userId: string,
    cardToken?: string,
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
    createOrder: (orderId, userId, cardToken = TEST_CARD.APPROVED) =>
      server.call(
        orderService.createOrder,
        createOrderRequest(orderId, {
          userId,
          cardToken,
          paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
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
  };
}
