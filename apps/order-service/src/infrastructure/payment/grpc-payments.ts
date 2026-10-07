/**
 * Payments portunun gRPC uygulamasi: order -> payment (T7.1).
 *
 * Tasima isi service-kit callUnary'dedir; burasi yalnizca domain <-> proto
 * cevirisini yapar. payment-svc'nin is hatalari (THREEDS_FAILED ve kalan hak)
 * fromServiceError ile KODU ve AYRINTISI korunarak AppError'a doner.
 */

import { AppError, ERROR_CODES, isAppError, isErrorCode } from '@getir/core';
import type { ErrorCode } from '@getir/core';
import { paymentV1 } from '@getir/proto';
import { callUnary } from '@getir/service-kit';
import type { OutgoingCallOptions } from '@getir/service-kit';
import { credentials } from '@grpc/grpc-js';

import type {
  ChargeRequest,
  ConfirmThreeDsRequest,
  Payments,
  RefundRequest,
} from '../../application/payments.js';
import type { RequestScope } from '../../application/request-scope.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../domain/checkout-payment.js';
import type { PaymentMethod, PaymentResult, PaymentStatus } from '../../domain/checkout-payment.js';
import type { PaymentSnapshot } from '../../domain/payment-standing.js';
import { IDEMPOTENT, NOT_IDEMPOTENT, outgoingOptions } from '../grpc-resilience.js';
import type { ClientResilience } from '../grpc-resilience.js';

const METHOD_TO_PROTO: Readonly<Record<PaymentMethod, paymentV1.PaymentMethod>> = {
  [PAYMENT_METHOD.CARD]: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
  [PAYMENT_METHOD.CASH_ON_DELIVERY]: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
};

/** Proto yontem -> domain. UNSPECIFIED/UNRECOGNIZED: yontemi bilinmeyen kayitla karar verilmez. */
const METHOD_FROM_PROTO: Readonly<Record<paymentV1.PaymentMethod, PaymentMethod | undefined>> = {
  [paymentV1.PaymentMethod.PAYMENT_METHOD_UNSPECIFIED]: undefined,
  [paymentV1.PaymentMethod.PAYMENT_METHOD_CARD]: PAYMENT_METHOD.CARD,
  [paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY]: PAYMENT_METHOD.CASH_ON_DELIVERY,
  [paymentV1.PaymentMethod.UNRECOGNIZED]: undefined,
};

/** Proto durum -> domain. UNSPECIFIED/UNRECOGNIZED: durumsuz odemeyle siparis ilerletilmez. */
const STATUS_FROM_PROTO: Readonly<Record<paymentV1.PaymentStatus, PaymentStatus | undefined>> = {
  [paymentV1.PaymentStatus.PAYMENT_STATUS_UNSPECIFIED]: undefined,
  [paymentV1.PaymentStatus.PAYMENT_STATUS_PENDING]: PAYMENT_STATUS.PENDING,
  [paymentV1.PaymentStatus.PAYMENT_STATUS_REQUIRES_3DS]: PAYMENT_STATUS.REQUIRES_3DS,
  [paymentV1.PaymentStatus.PAYMENT_STATUS_SUCCEEDED]: PAYMENT_STATUS.SUCCEEDED,
  [paymentV1.PaymentStatus.PAYMENT_STATUS_FAILED]: PAYMENT_STATUS.FAILED,
  [paymentV1.PaymentStatus.PAYMENT_STATUS_REFUNDED]: PAYMENT_STATUS.REFUNDED,
  [paymentV1.PaymentStatus.PAYMENT_STATUS_CANCELLED]: PAYMENT_STATUS.CANCELLED,
  [paymentV1.PaymentStatus.UNRECOGNIZED]: undefined,
};

export class GrpcPayments implements Payments {
  private readonly client: paymentV1.PaymentServiceClient;

  constructor(
    address: string,
    private readonly timeoutMs: number,
    private readonly resilience: ClientResilience = {},
  ) {
    this.client = new paymentV1.PaymentServiceClient(address, credentials.createInsecure());
  }

  async charge(request: ChargeRequest, scope: RequestScope): Promise<PaymentResult> {
    const response = await callUnary<paymentV1.ChargeRequest, paymentV1.ChargeResponse>(
      (message, metadata, options, callback) =>
        this.client.charge(message, metadata, options, callback),
      {
        orderId: request.orderId,
        userId: request.userId,
        amount: { amountMinor: request.amountMinor, currency: request.currency },
        method: METHOD_TO_PROTO[request.method],
        cardToken: request.cardToken ?? '',
        // Kayitli kart (T12.4): sozlesmede var, order PR'i doldurur.
        cardId: '',
        idempotencyKey: request.idempotencyKey,
        requireThreeDs: request.requireThreeDs,
      },
      this.options(scope, IDEMPOTENT),
    );
    return toPaymentResult(request.orderId, response.payment, response.challengeId);
  }

  async confirmThreeDs(
    request: ConfirmThreeDsRequest,
    scope: RequestScope,
  ): Promise<PaymentResult> {
    const response = await callUnary<paymentV1.Confirm3DsRequest, paymentV1.Confirm3DsResponse>(
      (message, metadata, options, callback) =>
        this.client.confirm3Ds(message, metadata, options, callback),
      { orderId: request.orderId, challengeId: request.challengeId, code: request.code },
      this.options(scope, NOT_IDEMPOTENT),
    );
    return toPaymentResult(request.orderId, response.payment, '');
  }

  async refund(request: RefundRequest, scope: RequestScope): Promise<void> {
    await callUnary<paymentV1.RefundRequest, paymentV1.RefundResponse>(
      (message, metadata, options, callback) =>
        this.client.refund(message, metadata, options, callback),
      {
        orderId: request.orderId,
        reason: request.reason,
        idempotencyKey: request.idempotencyKey,
      },
      this.options(scope, IDEMPOTENT),
    );
  }

  /**
   * Odeme kaydini okur (T11.2 PR 2). Kayit yoksa payment-svc NOT_FOUND doner:
   * o siparis icin hic cekim istenmemistir (null).
   */
  async getPayment(orderId: string, scope: RequestScope): Promise<PaymentSnapshot | null> {
    let response: paymentV1.GetPaymentResponse;
    try {
      response = await callUnary<paymentV1.GetPaymentRequest, paymentV1.GetPaymentResponse>(
        (message, metadata, options, callback) =>
          this.client.getPayment(message, metadata, options, callback),
        { orderId },
        this.options(scope, IDEMPOTENT),
      );
    } catch (error: unknown) {
      if (isAppError(error) && error.code === ERROR_CODES.NOT_FOUND) {
        return null;
      }
      throw error;
    }
    return toSnapshot(orderId, response.payment);
  }

  /** Kapanista cagrilir: acik HTTP/2 baglantisi process'i ayakta tutmasin. */
  close(): void {
    this.client.close();
  }

  /** Devre her cagrida; yeniden deneme yalnizca idempotent cagrida (D17, grpc-resilience.ts). */
  private options(scope: RequestScope, idempotent: boolean): OutgoingCallOptions {
    return outgoingOptions(scope, this.timeoutMs, this.resilience, idempotent);
  }
}

function toPaymentResult(
  orderId: string,
  payment: paymentV1.Payment | undefined,
  challengeId: string,
): PaymentResult {
  const status = payment === undefined ? undefined : STATUS_FROM_PROTO[payment.status];
  if (payment === undefined || status === undefined) {
    throw AppError.internal('Odeme servisi durumsuz cevap dondu', { details: { orderId } });
  }
  return {
    status,
    ...(status === PAYMENT_STATUS.FAILED ? { failureCode: failureCodeOf(payment) } : {}),
    ...(challengeId === '' ? {} : { challengeId }),
  };
}

function toSnapshot(orderId: string, payment: paymentV1.Payment | undefined): PaymentSnapshot {
  const status = payment === undefined ? undefined : STATUS_FROM_PROTO[payment.status];
  const method = payment === undefined ? undefined : METHOD_FROM_PROTO[payment.method];
  if (status === undefined || method === undefined) {
    throw AppError.internal('Odeme servisi durumu ya da yontemi bilinmeyen kayit dondu', {
      details: { orderId },
    });
  }
  return { status, method };
}

/** Sozlukte olmayan ya da bos neden: kart reddi sayilir (para cekilmedi). */
function failureCodeOf(payment: paymentV1.Payment): ErrorCode {
  return isErrorCode(payment.failureCode) ? payment.failureCode : ERROR_CODES.PAYMENT_DECLINED;
}
