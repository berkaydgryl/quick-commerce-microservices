/**
 * CreateOrder kapi testi (saga, T7.1): gercek gRPC sunucusu, sahte risk ve odeme.
 */

import { ERROR_CODES, GRPC_STATUS, RISK_BANDS } from '@getir/core';
import { orderV1, paymentV1 } from '@getir/proto';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeRiskAssessment } from '../../support/fake-risk-assessment.js';
import { TEST_CARD } from '../../support/fake-payments.js';
import { appErrorOf } from '@getir/service-kit/testing';
import { createOrderRequest } from '../../support/order-fixtures.js';
import { newDraftId, useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const risk = new FakeRiskAssessment();
const call = useOrderGrpcServer({ risk });

beforeEach(() => {
  risk.band = RISK_BANDS.LOW;
});

async function createOrder(overrides: Partial<orderV1.CreateOrderRequest> = {}) {
  const orderId = await newDraftId(call);
  const result = await call(
    orderV1.OrderServiceService.createOrder,
    createOrderRequest(orderId, overrides),
  );
  return { orderId, ...result };
}

describe('CreateOrder', () => {
  it('onaylanan kart: siparis PAID, challengeId bos', async () => {
    const { orderId, error, response } = await createOrder();

    expect(error).toBeUndefined();
    expect(response).toEqual({
      orderId,
      status: orderV1.OrderStatus.ORDER_STATUS_PAID,
      challengeId: '',
    });
  });

  it('kart reddi (roadmap olcutu): FAILED_PRECONDITION + PAYMENT_DECLINED, siparis PAYMENT_FAILED', async () => {
    const { orderId, error } = await createOrder({ cardToken: TEST_CARD.DECLINED });

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.PAYMENT_DECLINED,
      details: { orderId, status: 'PAYMENT_FAILED' },
    });
    const { response } = await call(orderV1.OrderServiceService.getOrder, {
      orderId,
      userId: 'usr_1',
    });
    expect(response?.order?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAYMENT_FAILED);
  });

  it('gateway sinyalleri (T7.5) telden risk degerlendirmesine ulasir; bos alan tasinmaz', async () => {
    const { error } = await createOrder({
      signals: orderV1.CheckoutSignals.fromPartial({ ipAddress: '85.105.1.20' }),
    });

    expect(error).toBeUndefined();
    expect(risk.contexts.at(-1)?.signals).toEqual({ ipAddress: '85.105.1.20' });
  });

  it('MEDIUM bant: 3DS bekler, challengeId doner', async () => {
    risk.band = RISK_BANDS.MEDIUM;

    const { response } = await createOrder();

    expect(response?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_AWAITING_PAYMENT);
    expect(response?.challengeId).toBe('tds_sahte_dogrulama');
  });

  it('MEDIUM + kapida odeme: FAILED_PRECONDITION + PAYMENT_METHOD_NOT_ALLOWED', async () => {
    risk.band = RISK_BANDS.MEDIUM;

    const { error } = await createOrder({
      paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
      cardToken: '',
    });

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.PAYMENT_METHOD_NOT_ALLOWED);
  });

  it('CRITICAL bant: PERMISSION_DENIED + RISK_BLOCKED', async () => {
    risk.band = RISK_BANDS.CRITICAL;

    const { error } = await createOrder();

    expect(error?.code).toBe(GRPC_STATUS.PERMISSION_DENIED);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.RISK_BLOCKED);
  });

  it.each([
    [
      'yontem yok',
      { paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_UNSPECIFIED },
      'paymentMethod',
    ],
    ['kartli odemede jeton yok', { cardToken: '' }, 'cardToken'],
    [
      'kapida odemede jeton dolu',
      { paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY },
      'cardToken',
    ],
  ])('gecersiz odeme istegi (%s): INVALID_ARGUMENT', async (_name, overrides, field) => {
    const { error } = await createOrder(overrides);

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(Object.keys(appErrorOf(error)?.details as object)).toEqual([field]);
  });

  it('baskasinin siparisini NOT_FOUND ile reddeder', async () => {
    const { error } = await createOrder({ userId: 'usr_2' });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });

  it('odenmis siparis ikinci kez olusturulursa FAILED_PRECONDITION + ORDER_STATE_INVALID', async () => {
    const request = createOrderRequest(await newDraftId(call));

    await call(orderV1.OrderServiceService.createOrder, request);
    const { error } = await call(orderV1.OrderServiceService.createOrder, request);

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.ORDER_STATE_INVALID);
  });
});
