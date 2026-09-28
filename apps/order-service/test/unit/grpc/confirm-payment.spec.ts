/**
 * ConfirmPayment kapi testi (T7.1): 3DS isteyen siparis, gercek gRPC sunucusu uzerinden.
 */

import { AppError, ERROR_CODES, GRPC_STATUS, RISK_BANDS } from '@getir/core';
import { orderV1 } from '@getir/proto';
import { describe, expect, it } from 'vitest';

import { FAKE_CHALLENGE_ID, FakePayments } from '../../support/fake-payments.js';
import { FakeRiskAssessment } from '../../support/fake-risk-assessment.js';
import { appErrorOf } from '@getir/service-kit/testing';
import { confirmPaymentRequest, createOrderRequest } from '../../support/order-fixtures.js';
import { newDraftId, useOrderGrpcServer } from '../../support/order-grpc-harness.js';

const risk = new FakeRiskAssessment();
risk.band = RISK_BANDS.MEDIUM;
const payments = new FakePayments();
const call = useOrderGrpcServer({ risk, payments });

/** 3DS bekleyen siparis (MEDIUM bant). */
async function awaiting3Ds(): Promise<string> {
  const orderId = await newDraftId(call);
  await call(orderV1.OrderServiceService.createOrder, createOrderRequest(orderId));
  return orderId;
}

describe('ConfirmPayment', () => {
  it('dogru kod: siparis PAID', async () => {
    const orderId = await awaiting3Ds();
    payments.confirmOutcome = { status: 'SUCCEEDED' };

    const { error, response } = await call(
      orderV1.OrderServiceService.confirmPayment,
      confirmPaymentRequest(orderId, FAKE_CHALLENGE_ID),
    );

    expect(error).toBeUndefined();
    expect(response).toEqual({ orderId, status: orderV1.OrderStatus.ORDER_STATUS_PAID });
  });

  it('yanlis kod: payment-svc nin THREEDS_FAILED i kalan hakkiyla istemciye ulasir', async () => {
    const orderId = await awaiting3Ds();
    payments.confirmOutcome = new AppError(ERROR_CODES.THREEDS_FAILED, 'yanlis kod', {
      details: { attemptsLeft: 2, reason: 'wrong_code' },
    });

    const { error } = await call(
      orderV1.OrderServiceService.confirmPayment,
      confirmPaymentRequest(orderId, FAKE_CHALLENGE_ID, { code: '000000' }),
    );

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)).toEqual({
      code: ERROR_CODES.THREEDS_FAILED,
      details: { attemptsLeft: 2, reason: 'wrong_code' },
    });
  });

  it.each([
    ['bicimi bozuk kod (hak yanmaz)', { code: '12ab' }, 'code'],
    ['jeton yok', { challengeId: '' }, 'challengeId'],
    ['anahtar yok (ADR-08)', { idempotencyKey: '' }, 'idempotencyKey'],
  ])('%s: INVALID_ARGUMENT, payment-svc ye gidilmez', async (_name, overrides, field) => {
    const before = payments.confirmations.length;

    const { error } = await call(
      orderV1.OrderServiceService.confirmPayment,
      confirmPaymentRequest('ord_herhangi', FAKE_CHALLENGE_ID, overrides),
    );

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(Object.keys(appErrorOf(error)?.details as object)).toEqual([field]);
    expect(payments.confirmations).toHaveLength(before);
  });
});
