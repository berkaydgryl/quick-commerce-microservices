/**
 * Uctan uca kapi testi: gercek gRPC sunucusu + gercek istemci.
 * T5.1'in "bitti sayilir" olcutunun (4242... onay, 4000... ret) otomatik karsiligi.
 */

import { ERROR_CODES, GRPC_STATUS, MOCK_THREEDS_CODE } from '@getir/core';
import { paymentV1 } from '@getir/proto';
import { appErrorOf, unaryCall } from '@getir/service-kit/testing';
import type { CallResult } from '@getir/service-kit/testing';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPaymentService } from '../support/payment-grpc-client.js';
import type { RunningPaymentService } from '../support/payment-grpc-client.js';

let service: RunningPaymentService;

function call<TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
): Promise<CallResult<TResponse>> {
  return unaryCall(service.client, method, request);
}

const errorCodeOf = (error: ServiceError | undefined): string | undefined =>
  appErrorOf(error)?.code;
const errorDetailsOf = (error: ServiceError | undefined): unknown => appErrorOf(error)?.details;

let sequence = 0;
function chargeRequest(cardToken: string): paymentV1.ChargeRequest {
  sequence += 1;
  return {
    orderId: `ord_${sequence}`,
    userId: 'usr_1',
    amount: { amountMinor: 12_990, currency: 'TRY' },
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    cardToken,
    idempotencyKey: `anahtar-${sequence}-000`,
    requireThreeDs: false,
  };
}

beforeAll(async () => {
  service = await startPaymentService();
});

afterAll(async () => {
  await service?.stop();
});

describe('PaymentService/Charge', () => {
  it('4242 onaylanir', async () => {
    const { error, response } = await call(
      paymentV1.PaymentServiceService.charge,
      chargeRequest('tok_test_4242'),
    );

    expect(error).toBeUndefined();
    expect(response?.payment?.status).toBe(paymentV1.PaymentStatus.PAYMENT_STATUS_SUCCEEDED);
    expect(response?.payment?.amount).toEqual({ amountMinor: 12_990, currency: 'TRY' });
    expect(response?.challengeId).toBe('');
  });

  it('4000...0002 reddedilir: gRPC hatasi degil, FAILED + PAYMENT_DECLINED', async () => {
    const { error, response } = await call(
      paymentV1.PaymentServiceService.charge,
      chargeRequest('tok_test_0002'),
    );

    expect(error).toBeUndefined();
    expect(response?.payment?.status).toBe(paymentV1.PaymentStatus.PAYMENT_STATUS_FAILED);
    expect(response?.payment?.failureCode).toBe(ERROR_CODES.PAYMENT_DECLINED);
  });

  it('3DS karti REQUIRES_3DS ve challengeId doner', async () => {
    const { response } = await call(
      paymentV1.PaymentServiceService.charge,
      chargeRequest('tok_test_3184'),
    );

    expect(response?.payment?.status).toBe(paymentV1.PaymentStatus.PAYMENT_STATUS_REQUIRES_3DS);
    expect(response?.challengeId).toMatch(/^tds_[0-9a-f]{32}$/);
  });

  it('risk 3DS isterse (T7.1) onaylanacak kart da REQUIRES_3DS + challengeId doner', async () => {
    const { response } = await call(paymentV1.PaymentServiceService.charge, {
      ...chargeRequest('tok_test_4242'),
      requireThreeDs: true,
    });

    expect(response?.payment?.status).toBe(paymentV1.PaymentStatus.PAYMENT_STATUS_REQUIRES_3DS);
    expect(response?.challengeId).toMatch(/^tds_[0-9a-f]{32}$/);
  });

  it('gecersiz istek INVALID_ARGUMENT + VALIDATION_FAILED', async () => {
    const { error } = await call(paymentV1.PaymentServiceService.charge, {
      ...chargeRequest('tok_test_4242'),
      amount: { amountMinor: 0, currency: 'TRY' },
    });

    expect(error?.code).toBe(GRPC_STATUS.INVALID_ARGUMENT);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

async function chargeWith3Ds(): Promise<{ orderId: string; challengeId: string }> {
  const request = chargeRequest('tok_test_3184');
  const { response } = await call(paymentV1.PaymentServiceService.charge, request);
  return { orderId: request.orderId, challengeId: response?.challengeId ?? '' };
}

describe('PaymentService/Confirm3Ds', () => {
  it('dogru kod SUCCEEDED doner', async () => {
    const { orderId, challengeId } = await chargeWith3Ds();

    const { error, response } = await call(paymentV1.PaymentServiceService.confirm3Ds, {
      orderId,
      challengeId,
      code: MOCK_THREEDS_CODE,
    });

    expect(error).toBeUndefined();
    expect(response?.payment?.status).toBe(paymentV1.PaymentStatus.PAYMENT_STATUS_SUCCEEDED);
  });

  it('yanlis kod FAILED_PRECONDITION + THREEDS_FAILED, kalan hak ayrintida', async () => {
    const { orderId, challengeId } = await chargeWith3Ds();

    const { error } = await call(paymentV1.PaymentServiceService.confirm3Ds, {
      orderId,
      challengeId,
      code: '000000',
    });

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.THREEDS_FAILED);
    expect(errorDetailsOf(error)).toEqual({ attemptsLeft: 2, reason: 'wrong_code' });
  });

  it('bicimi bozuk kod deneme sayilmaz: VALIDATION_FAILED', async () => {
    const { orderId, challengeId } = await chargeWith3Ds();

    const { error } = await call(paymentV1.PaymentServiceService.confirm3Ds, {
      orderId,
      challengeId,
      code: '12ab',
    });

    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('bilinmeyen jeton NOT_FOUND', async () => {
    const { error } = await call(paymentV1.PaymentServiceService.confirm3Ds, {
      orderId: 'ord_yok',
      challengeId: 'tds_yok',
      code: MOCK_THREEDS_CODE,
    });

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
  });

  it('henuz yazilmayan GetPayment UNIMPLEMENTED; x-app-error NOT_IMPLEMENTED (D5)', async () => {
    const { error } = await call(paymentV1.PaymentServiceService.getPayment, { orderId: 'ord_1' });

    expect(error?.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
    // grpc-js'in kendi cevabi degil, standart hata yolu: gateway 501 gosterir.
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.NOT_IMPLEMENTED);
  });
});

describe('PaymentService/Refund (T7.1)', () => {
  const refundRequest = (orderId: string): paymentV1.RefundRequest => ({
    orderId,
    reason: 'order_cancelled',
    idempotencyKey: `iade-${orderId}`,
  });

  it('onaylanmis cekim iade edilir; tekrar istek already_refunded = true', async () => {
    const request = chargeRequest('tok_test_4242');
    await call(paymentV1.PaymentServiceService.charge, request);

    const first = await call(
      paymentV1.PaymentServiceService.refund,
      refundRequest(request.orderId),
    );
    const second = await call(
      paymentV1.PaymentServiceService.refund,
      refundRequest(request.orderId),
    );

    expect(first.error).toBeUndefined();
    expect(first.response?.payment?.status).toBe(paymentV1.PaymentStatus.PAYMENT_STATUS_REFUNDED);
    expect(first.response?.alreadyRefunded).toBe(false);
    expect(second.response?.alreadyRefunded).toBe(true);
  });

  it('reddedilmis cekim iade edilemez: ABORTED + CONFLICT', async () => {
    const request = chargeRequest('tok_test_0002');
    await call(paymentV1.PaymentServiceService.charge, request);

    const { error } = await call(
      paymentV1.PaymentServiceService.refund,
      refundRequest(request.orderId),
    );

    expect(error?.code).toBe(GRPC_STATUS.ABORTED);
    expect(errorCodeOf(error)).toBe(ERROR_CODES.CONFLICT);
  });

  it('gerekce ve anahtar zorunlu: VALIDATION_FAILED', async () => {
    const { error } = await call(paymentV1.PaymentServiceService.refund, {
      orderId: 'ord_1',
      reason: '',
      idempotencyKey: '',
    });

    expect(errorCodeOf(error)).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(Object.keys(errorDetailsOf(error) as object).sort()).toEqual([
      'idempotencyKey',
      'reason',
    ]);
  });
});
