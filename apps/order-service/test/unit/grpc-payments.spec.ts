/**
 * order -> payment gRPC istemcisi (T7.1), GERCEK tel uzerinden: sahte bir
 * payment sunucusu ayaga kalkar. Istek/sonuc cevirisi, is hatasinin kodu ve
 * AYRINTISIYLA korunmasi (3DS kalan hak) ve requestId iletimi denenir. Kaydin
 * okunmasi (GetPayment, T11.2 PR 2): yontem ve durum, kayit yoksa null.
 */

import { AppError, ERROR_CODES, silentLogger } from '@getir/core';
import { paymentV1 } from '@getir/proto';
import { REQUEST_ID_METADATA_KEY, startGrpcServer, toServiceError } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import type { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ChargeRequest } from '../../src/application/payments.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/checkout-payment.js';
import { GrpcPayments } from '../../src/infrastructure/payment/grpc-payments.js';

const scope = { requestId: 'req_odeme_1', logger: silentLogger };
const S = paymentV1.PaymentStatus;

const seenCharges: paymentV1.ChargeRequest[] = [];
const seenRefunds: paymentV1.RefundRequest[] = [];
const seenRequestIds: unknown[] = [];
const seenLookups: { orderId: string; requestId: unknown }[] = [];

function payment(status: paymentV1.PaymentStatus, failureCode = ''): paymentV1.Payment {
  return paymentV1.Payment.fromPartial({ id: 'pay_1', orderId: 'ord_1', status, failureCode });
}

/** Sahte sunucunun jetona gore karari. */
const CHARGE_RESPONSES: Readonly<Record<string, paymentV1.ChargeResponse>> = {
  tok_onay: { payment: payment(S.PAYMENT_STATUS_SUCCEEDED), challengeId: '' },
  tok_red: { payment: payment(S.PAYMENT_STATUS_FAILED, 'PAYMENT_DECLINED'), challengeId: '' },
  tok_tuhaf_neden: { payment: payment(S.PAYMENT_STATUS_FAILED, 'BILINMEYEN'), challengeId: '' },
  tok_3ds: { payment: payment(S.PAYMENT_STATUS_REQUIRES_3DS), challengeId: 'tds_1' },
  tok_durumsuz: { payment: payment(S.PAYMENT_STATUS_UNSPECIFIED), challengeId: '' },
  '': { payment: payment(S.PAYMENT_STATUS_PENDING), challengeId: '' },
};

/** GetPayment'in siparise gore kaydi; olmayan siparis NOT_FOUND. */
const RECORDS: Readonly<Record<string, paymentV1.Payment | 'kapali'>> = {
  ord_kart_cekildi: paymentV1.Payment.fromPartial({
    orderId: 'ord_kart_cekildi',
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
    status: S.PAYMENT_STATUS_SUCCEEDED,
  }),
  ord_kapida: paymentV1.Payment.fromPartial({
    orderId: 'ord_kapida',
    method: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
    status: S.PAYMENT_STATUS_PENDING,
  }),
  ord_yontemsiz: paymentV1.Payment.fromPartial({
    orderId: 'ord_yontemsiz',
    status: S.PAYMENT_STATUS_SUCCEEDED,
  }),
  ord_kapali: 'kapali',
};

const implementation = {
  charge: (
    call: ServerUnaryCall<paymentV1.ChargeRequest, paymentV1.ChargeResponse>,
    callback: sendUnaryData<paymentV1.ChargeResponse>,
  ): void => {
    seenCharges.push(call.request);
    seenRequestIds.push(call.metadata.get(REQUEST_ID_METADATA_KEY)[0]);
    const response = CHARGE_RESPONSES[call.request.cardToken];
    callback(null, response ?? CHARGE_RESPONSES['tok_onay']);
  },
  confirm3Ds: (
    call: ServerUnaryCall<paymentV1.Confirm3DsRequest, paymentV1.Confirm3DsResponse>,
    callback: sendUnaryData<paymentV1.Confirm3DsResponse>,
  ): void => {
    if (call.request.code !== '123456') {
      callback(
        toServiceError(
          new AppError(ERROR_CODES.THREEDS_FAILED, 'yanlis kod', {
            details: { attemptsLeft: 2, reason: 'wrong_code' },
          }),
        ),
      );
      return;
    }
    callback(null, { payment: payment(S.PAYMENT_STATUS_SUCCEEDED) });
  },
  getPayment: (
    call: ServerUnaryCall<paymentV1.GetPaymentRequest, paymentV1.GetPaymentResponse>,
    callback: sendUnaryData<paymentV1.GetPaymentResponse>,
  ): void => {
    seenLookups.push({
      orderId: call.request.orderId,
      requestId: call.metadata.get(REQUEST_ID_METADATA_KEY)[0],
    });
    const recorded = RECORDS[call.request.orderId];
    if (recorded === undefined) {
      callback(toServiceError(new AppError(ERROR_CODES.NOT_FOUND, 'odeme yok')));
      return;
    }
    if (recorded === 'kapali') {
      callback(toServiceError(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali')));
      return;
    }
    callback(null, { payment: recorded });
  },
  refund: (
    call: ServerUnaryCall<paymentV1.RefundRequest, paymentV1.RefundResponse>,
    callback: sendUnaryData<paymentV1.RefundResponse>,
  ): void => {
    seenRefunds.push(call.request);
    callback(null, { payment: payment(S.PAYMENT_STATUS_REFUNDED), alreadyRefunded: false });
  },
};

let handle: GrpcServerHandle;
let payments: GrpcPayments;

beforeAll(async () => {
  handle = await startGrpcServer({
    serviceName: 'fake-payment',
    host: '127.0.0.1',
    port: 0,
    services: [
      {
        name: 'getir.payment.v1.PaymentService',
        definition: paymentV1.PaymentServiceService,
        implementation,
      },
    ],
  });
  payments = new GrpcPayments(`127.0.0.1:${handle.port}`, 500);
});

afterAll(async () => {
  payments?.close();
  await handle?.shutdown('test bitti');
});

const charge = (overrides: Partial<ChargeRequest> = {}): ChargeRequest => ({
  orderId: 'ord_1',
  userId: 'usr_1',
  amountMinor: 7_990,
  currency: 'TRY',
  method: PAYMENT_METHOD.CARD,
  cardToken: 'tok_onay',
  idempotencyKey: 'charge-ord_1',
  requireThreeDs: true,
  ...overrides,
});

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError beklenirdi');
}

describe('GrpcPayments.charge', () => {
  it('istek telde birebir (tutar, yontem, anahtar, 3DS bayragi); requestId AYNEN iletilir', async () => {
    await expect(payments.charge(charge(), scope)).resolves.toEqual({
      status: PAYMENT_STATUS.SUCCEEDED,
    });
    expect(seenCharges.at(-1)).toEqual({
      orderId: 'ord_1',
      userId: 'usr_1',
      amount: { amountMinor: 7_990, currency: 'TRY' },
      method: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
      cardToken: 'tok_onay',
      idempotencyKey: 'charge-ord_1',
      requireThreeDs: true,
    });
    expect(seenRequestIds.at(-1)).toBe(scope.requestId);
  });

  it('kapida odeme: jeton bos gider, PENDING doner', async () => {
    const { cardToken: _omitted, ...withoutToken } = charge({
      method: PAYMENT_METHOD.CASH_ON_DELIVERY,
      requireThreeDs: false,
    });

    await expect(payments.charge(withoutToken, scope)).resolves.toEqual({
      status: PAYMENT_STATUS.PENDING,
    });
    expect(seenCharges.at(-1)?.method).toBe(
      paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
    );
    expect(seenCharges.at(-1)?.cardToken).toBe('');
  });

  it.each([
    ['tok_red', { status: PAYMENT_STATUS.FAILED, failureCode: ERROR_CODES.PAYMENT_DECLINED }],
    // Sozlukte olmayan neden: kart reddi sayilir (para cekilmedi).
    [
      'tok_tuhaf_neden',
      { status: PAYMENT_STATUS.FAILED, failureCode: ERROR_CODES.PAYMENT_DECLINED },
    ],
    ['tok_3ds', { status: PAYMENT_STATUS.REQUIRES_3DS, challengeId: 'tds_1' }],
  ])('%s -> %o', async (cardToken, expected) => {
    await expect(payments.charge(charge({ cardToken }), scope)).resolves.toEqual(expected);
  });

  it('durumsuz cevapla siparis ilerletilmez: INTERNAL', async () => {
    const error = await rejectionOf(payments.charge(charge({ cardToken: 'tok_durumsuz' }), scope));

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });
});

describe('GrpcPayments.confirmThreeDs ve refund', () => {
  it('dogru kod SUCCEEDED', async () => {
    await expect(
      payments.confirmThreeDs({ orderId: 'ord_1', challengeId: 'tds_1', code: '123456' }, scope),
    ).resolves.toEqual({ status: PAYMENT_STATUS.SUCCEEDED });
  });

  it('payment-svc nin THREEDS_FAILED i kodu ve AYRINTISIYLA (kalan hak) korunur', async () => {
    const error = await rejectionOf(
      payments.confirmThreeDs({ orderId: 'ord_1', challengeId: 'tds_1', code: '000000' }, scope),
    );

    expect(error.code).toBe(ERROR_CODES.THREEDS_FAILED);
    expect(error.details).toEqual({ attemptsLeft: 2, reason: 'wrong_code' });
  });

  it('iade istegi gerekce ve anahtarla gider', async () => {
    await payments.refund(
      { orderId: 'ord_1', reason: 'order_changed_during_payment', idempotencyKey: 'refund-ord_1' },
      scope,
    );

    expect(seenRefunds.at(-1)).toEqual({
      orderId: 'ord_1',
      reason: 'order_changed_during_payment',
      idempotencyKey: 'refund-ord_1',
    });
  });
});

describe('GrpcPayments.getPayment (T11.2 PR 2)', () => {
  it('kaydin durumu ve yontemi domain sozlugune cevrilir; requestId AYNEN iletilir', async () => {
    await expect(payments.getPayment('ord_kart_cekildi', scope)).resolves.toEqual({
      status: PAYMENT_STATUS.SUCCEEDED,
      method: PAYMENT_METHOD.CARD,
    });
    await expect(payments.getPayment('ord_kapida', scope)).resolves.toEqual({
      status: PAYMENT_STATUS.PENDING,
      method: PAYMENT_METHOD.CASH_ON_DELIVERY,
    });
    expect(seenLookups.at(-1)).toEqual({ orderId: 'ord_kapida', requestId: scope.requestId });
  });

  it('kayit yoksa (NOT_FOUND) null: o siparis icin hic cekim istenmedi', async () => {
    await expect(payments.getPayment('ord_cekimsiz', scope)).resolves.toBeNull();
  });

  it('yontemi bilinmeyen kayitla karar verilmez: INTERNAL', async () => {
    const error = await rejectionOf(payments.getPayment('ord_yontemsiz', scope));

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('payment-svc hatasi AYNEN yukari gider (iptal ve supurucu karar vermez)', async () => {
    const error = await rejectionOf(payments.getPayment('ord_kapali', scope));

    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
  });
});
