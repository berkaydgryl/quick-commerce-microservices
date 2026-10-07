/**
 * Sahte payment servisi. Test kartlari payment-svc'deki mock saglayiciyla AYNI
 * jetonlar ve ayni kurallar (T5.1, T7.1):
 *   tok_test_4242 onay, tok_test_0002 red, tok_test_3184 3DS; kapida odeme PENDING;
 *   requireThreeDs onaylanacak karti 3DS'e cevirir.
 * payment-svc gibi idempotent: ayni anahtarla ikinci cekim ilk sonucu doner.
 * Odeme kaydi (getPayment) cekimlerden kurulur: son sonuc ve yontem; iade
 * kaydi REFUNDED yapar. Test kaydi `payments` ile dogrudan da kurabilir.
 *
 * Kayitli kart (T12.4): `cards` kasadir (kimlik -> sahip ve jeton). payment-svc
 * gibi once tekrar (ayni anahtar) bakilir, sonra kart cozulur; kart yoksa ya da
 * baskasininsa NOT_FOUND (resource "card") ve HICBIR kayit yazilmaz.
 */

import { AppError, ERROR_CODES } from '@getir/core';

import type {
  ChargeRequest,
  ConfirmThreeDsRequest,
  Payments,
  RefundRequest,
} from '../../src/application/payments.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/checkout-payment.js';
import type { PaymentResult } from '../../src/domain/checkout-payment.js';
import type { PaymentSnapshot } from '../../src/domain/payment-standing.js';

export const TEST_CARD = {
  APPROVED: 'tok_test_4242',
  DECLINED: 'tok_test_0002',
  CHALLENGE: 'tok_test_3184',
} as const;

export const FAKE_CHALLENGE_ID = 'tds_sahte_dogrulama';

/** payment-svc'nin cekim kararinin sahte karsiligi. */
export function fakeChargeResult(request: ChargeRequest): PaymentResult {
  if (request.method === PAYMENT_METHOD.CASH_ON_DELIVERY) {
    return { status: PAYMENT_STATUS.PENDING };
  }
  if (request.cardToken === TEST_CARD.DECLINED) {
    return { status: PAYMENT_STATUS.FAILED, failureCode: ERROR_CODES.PAYMENT_DECLINED };
  }
  if (request.cardToken === TEST_CARD.CHALLENGE || request.requireThreeDs) {
    return { status: PAYMENT_STATUS.REQUIRES_3DS, challengeId: FAKE_CHALLENGE_ID };
  }
  return { status: PAYMENT_STATUS.SUCCEEDED };
}

/** Kasadaki kart: sahibi ve saglayici jetonu (TEST_CARD'lardan biri). */
export interface FakeSavedCard {
  readonly userId: string;
  readonly token: string;
}

export class FakePayments implements Payments {
  readonly charges: ChargeRequest[] = [];
  readonly confirmations: ConfirmThreeDsRequest[] = [];
  readonly refunds: RefundRequest[] = [];
  private readonly byKey = new Map<string, PaymentResult>();

  /** Doluysa cekim bu hatayla basarisiz olur (orn. SERVICE_UNAVAILABLE). */
  chargeFailure: AppError | undefined;
  /** Cekim cevabindan ONCE calisir: es zamanli bir yazmayi taklit etmek icin. */
  beforeChargeReturns: (() => Promise<void>) | undefined;
  /** 3DS onayinin sonucu; hata verilirse onay onunla basarisiz olur. */
  confirmOutcome: PaymentResult | AppError = { status: PAYMENT_STATUS.SUCCEEDED };
  refundFailure: AppError | undefined;
  /** Siparis -> odeme kaydi (payment-svc'nin goruntusu). */
  readonly payments = new Map<string, PaymentSnapshot>();
  readonly lookups: string[] = [];
  /** Doluysa kayit okumasi bu hatayla basarisiz olur. */
  getPaymentFailure: AppError | undefined;
  /** Kart kasasi (T12.4): kart kimligi -> sahip ve jeton. */
  readonly cards = new Map<string, FakeSavedCard>();

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    this.charges.push(request);
    if (this.chargeFailure !== undefined) {
      throw this.chargeFailure;
    }
    const result =
      this.byKey.get(request.idempotencyKey) ?? fakeChargeResult(this.withCardToken(request));
    this.byKey.set(request.idempotencyKey, result);
    this.payments.set(request.orderId, { status: result.status, method: request.method });
    await this.beforeChargeReturns?.();
    return result;
  }

  /** Kayitli karti jetona cozer; kart yoksa NOT_FOUND (cagiran kayit yazmadan firlar). */
  private withCardToken(request: ChargeRequest): ChargeRequest {
    if (request.cardId === undefined) {
      return request;
    }
    const card = this.cards.get(request.cardId);
    if (card === undefined || card.userId !== request.userId) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Kart bulunamadi', {
        details: { resource: 'card' },
      });
    }
    return { ...request, cardToken: card.token };
  }

  confirmThreeDs(request: ConfirmThreeDsRequest): Promise<PaymentResult> {
    this.confirmations.push(request);
    if (!('status' in this.confirmOutcome)) {
      return Promise.reject(this.confirmOutcome);
    }
    const recorded = this.payments.get(request.orderId);
    if (recorded !== undefined) {
      this.payments.set(request.orderId, { ...recorded, status: this.confirmOutcome.status });
    }
    return Promise.resolve(this.confirmOutcome);
  }

  refund(request: RefundRequest): Promise<void> {
    this.refunds.push(request);
    if (this.refundFailure !== undefined) {
      return Promise.reject(this.refundFailure);
    }
    const recorded = this.payments.get(request.orderId);
    if (recorded !== undefined) {
      this.payments.set(request.orderId, { ...recorded, status: PAYMENT_STATUS.REFUNDED });
    }
    return Promise.resolve();
  }

  getPayment(orderId: string): Promise<PaymentSnapshot | null> {
    this.lookups.push(orderId);
    if (this.getPaymentFailure !== undefined) {
      return Promise.reject(this.getPaymentFailure);
    }
    return Promise.resolve(this.payments.get(orderId) ?? null);
  }
}
