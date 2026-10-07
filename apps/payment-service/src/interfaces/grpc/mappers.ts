/**
 * Domain -> sozlesme (proto) cevirisi. Esleme Record ile yazildi: yeni bir
 * durum ya da yontem eklendiginde eksik esleme DERLEMEDE yakalanir.
 */

import { paymentV1 } from '@getir/proto';

import type { PaymentRead } from '../../application/get-payment.js';
import type { Payment, PaymentMethod, PaymentStatus } from '../../domain/payment.js';

const STATUS_TO_PROTO: Readonly<Record<PaymentStatus, paymentV1.PaymentStatus>> = {
  PENDING: paymentV1.PaymentStatus.PAYMENT_STATUS_PENDING,
  REQUIRES_3DS: paymentV1.PaymentStatus.PAYMENT_STATUS_REQUIRES_3DS,
  SUCCEEDED: paymentV1.PaymentStatus.PAYMENT_STATUS_SUCCEEDED,
  FAILED: paymentV1.PaymentStatus.PAYMENT_STATUS_FAILED,
  REFUNDED: paymentV1.PaymentStatus.PAYMENT_STATUS_REFUNDED,
  CANCELLED: paymentV1.PaymentStatus.PAYMENT_STATUS_CANCELLED,
};

const METHOD_TO_PROTO: Readonly<Record<PaymentMethod, paymentV1.PaymentMethod>> = {
  CARD: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
  CASH_ON_DELIVERY: paymentV1.PaymentMethod.PAYMENT_METHOD_CASH_ON_DELIVERY,
};

export function toProtoPayment(payment: Payment): paymentV1.Payment {
  return {
    id: payment.id,
    orderId: payment.orderId,
    userId: payment.userId,
    amount: payment.amount,
    method: METHOD_TO_PROTO[payment.method],
    status: STATUS_TO_PROTO[payment.status],
    failureCode: payment.failureCode ?? '',
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/**
 * Sozlesme: challenge_id bos DEGILSE 3DS bekleniyor demektir; bitis (T12.4)
 * yalnizca onunla birlikte: kayittaki an (cekim + 3DS omru, payment saati),
 * tekrar istekte ilk cekiminki.
 */
export function toProtoChargeResponse(payment: Payment): paymentV1.ChargeResponse {
  return {
    payment: toProtoPayment(payment),
    challengeId: payment.challenge?.id ?? '',
    ...(payment.challenge === undefined ? {} : { challengeExpiresAt: payment.challenge.expiresAt }),
  };
}

/**
 * GetPayment cevabi: odeme ve 3DS durumu (#163 B1). Jeton yalnizca dogrulama
 * acikken dolu (bos metin = kapali); bitis ve kalan hak her zaman.
 */
export function toProtoGetPaymentResponse(read: PaymentRead): paymentV1.GetPaymentResponse {
  return {
    payment: toProtoPayment(read.payment),
    ...(read.threeDs === undefined
      ? {}
      : {
          threeDs: {
            challengeId: read.threeDs.challengeId ?? '',
            expiresAt: read.threeDs.expiresAt,
            attemptsLeft: read.threeDs.attemptsLeft,
          },
        }),
  };
}
