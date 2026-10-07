/**
 * Kapida odeme gRPC kapisi (T12.4): nakit ve POS, LOW bantta PAID; secim
 * GetOrder'da ve listede doner (kisisel veri degil). MEDIUM bantta
 * PAYMENT_METHOD_NOT_ALLOWED, siparis taslakta kalir ve kartla verilir.
 */

import { ERROR_CODES, GRPC_STATUS, RISK_BANDS } from '@getir/core';
import { orderV1, paymentV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeRiskAssessment } from '../../support/fake-risk-assessment.js';
import { createOrderRequest, draftRequest } from '../../support/order-fixtures.js';
import { newDraftId, useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const risk = new FakeRiskAssessment();
const call = useOrderGrpcServer({ risk });
const Orders = orderV1.OrderServiceService;
const Kind = orderV1.DeliveryPaymentKind;
const COD = paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY;

beforeEach(() => {
  risk.band = RISK_BANDS.LOW;
});

/** Kullanicinin taslagi + kapida odemeyle CreateOrder. */
async function placeOnDelivery(userId: string, onDelivery: orderV1.DeliveryPaymentKind) {
  const orderId = await newDraftId(call, { ...draftRequest, userId });
  const result = await call(
    Orders.createOrder,
    createOrderRequest(orderId, { userId, paymentMethod: COD, cardToken: '', onDelivery }),
  );
  return { orderId, ...result };
}

describe('CreateOrder kapida odeme (T12.4)', () => {
  it.each([
    ['nakit', Kind.DELIVERY_PAYMENT_KIND_CASH],
    ['POS', Kind.DELIVERY_PAYMENT_KIND_POS],
  ])('%s: PAID; GetOrder ve liste yontemi ve turu doner', async (name, kind) => {
    const userId = `usr_kapida-${name}`;
    const { orderId, error, response } = await placeOnDelivery(userId, kind);

    expect(error).toBeUndefined();
    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAID);
    const expected = { method: COD, onDelivery: kind };
    const got = await call(Orders.getOrder, { orderId, userId });
    expect(got.response?.order?.payment).toEqual(expected);
    const listed = await call(Orders.listMyOrders, { userId });
    expect(listed.response?.orders[0]?.payment).toEqual(expected);
  });

  it('kartla odeme: yontem CARD, tur bos', async () => {
    const userId = 'usr_kartli-secim';
    const orderId = await newDraftId(call, { ...draftRequest, userId });
    await call(Orders.createOrder, createOrderRequest(orderId, { userId }));

    const got = await call(Orders.getOrder, { orderId, userId });
    expect(got.response?.order?.payment).toEqual({
      method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
      onDelivery: Kind.DELIVERY_PAYMENT_KIND_UNSPECIFIED,
    });
  });

  it('MEDIUM: FAILED_PRECONDITION + PAYMENT_METHOD_NOT_ALLOWED; siparis taslakta, kartla verilir', async () => {
    risk.band = RISK_BANDS.MEDIUM;
    const userId = 'usr_kapida-orta';
    const { orderId, error } = await placeOnDelivery(userId, Kind.DELIVERY_PAYMENT_KIND_CASH);

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.PAYMENT_METHOD_NOT_ALLOWED);
    const draft = await call(Orders.getOrder, { orderId, userId });
    expect(draft.response?.order?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_DRAFT);
    expect(draft.response?.order?.payment).toBeUndefined();

    const byCard = await call(Orders.createOrder, createOrderRequest(orderId, { userId }));
    expect(byCard.error).toBeUndefined();
    expect(byCard.response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_AWAITING_PAYMENT);
  });
});
