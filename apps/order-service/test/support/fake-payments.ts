/**
 * Sahte payment servisi. Test kartlari payment-svc'deki mock saglayiciyla AYNI
 * jetonlar ve ayni kurallar (T5.1, T7.1):
 *   tok_test_4242 onay, tok_test_0002 red, tok_test_3184 3DS; kapida odeme PENDING;
 *   requireThreeDs onaylanacak karti 3DS'e cevirir.
 * payment-svc gibi idempotent: ayni anahtarla ikinci cekim ilk sonucu doner.
 */

import { ERROR_CODES } from '@getir/core';
import type { AppError } from '@getir/core';

import type {
  ChargeRequest,
  ConfirmThreeDsRequest,
  Payments,
  RefundRequest,
} from '../../src/application/payments.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/checkout-payment.js';
import type { PaymentResult } from '../../src/domain/checkout-payment.js';

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

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    this.charges.push(request);
    if (this.chargeFailure !== undefined) {
      throw this.chargeFailure;
    }
    const result = this.byKey.get(request.idempotencyKey) ?? fakeChargeResult(request);
    this.byKey.set(request.idempotencyKey, result);
    await this.beforeChargeReturns?.();
    return result;
  }

  confirmThreeDs(request: ConfirmThreeDsRequest): Promise<PaymentResult> {
    this.confirmations.push(request);
    return 'status' in this.confirmOutcome
      ? Promise.resolve(this.confirmOutcome)
      : Promise.reject(this.confirmOutcome);
  }

  refund(request: RefundRequest): Promise<void> {
    this.refunds.push(request);
    return this.refundFailure === undefined
      ? Promise.resolve()
      : Promise.reject(this.refundFailure);
  }
}
