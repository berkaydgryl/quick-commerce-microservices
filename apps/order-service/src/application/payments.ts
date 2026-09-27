/**
 * payment-svc PORTU (T7.1): cekim, 3DS onayi ve telafi iadesi. Uygulamasi
 * infrastructure/payment'ta (gRPC); testlerde sahtesi verilir.
 *
 * Kart reddi HATA DEGILDIR: sonuc FAILED + failureCode olarak doner ve saga
 * siparisi PAYMENT_FAILED yapar. Hata firlatan durumlar: payment-svc'ye
 * ulasilamamasi (SERVICE_UNAVAILABLE), yanlis 3DS kodu (THREEDS_FAILED,
 * ayrintida kalan hak) ve gecersiz istek.
 */

import type { PaymentMethod, PaymentResult } from '../domain/checkout-payment.js';
import type { RequestScope } from './request-scope.js';

export interface ChargeRequest {
  readonly orderId: string;
  readonly userId: string;
  /** Taslakta DONDURULMUS toplam (T7.2); istemciden gelmez. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly method: PaymentMethod;
  /** Yalnizca kartli odemede. */
  readonly cardToken?: string;
  readonly idempotencyKey: string;
  /** Orta risk bandi: banka onaylasa bile 3DS istenir. */
  readonly requireThreeDs: boolean;
}

export interface ConfirmThreeDsRequest {
  readonly orderId: string;
  readonly challengeId: string;
  readonly code: string;
}

export interface RefundRequest {
  readonly orderId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface Payments {
  charge(request: ChargeRequest, scope: RequestScope): Promise<PaymentResult>;
  confirmThreeDs(request: ConfirmThreeDsRequest, scope: RequestScope): Promise<PaymentResult>;
  refund(request: RefundRequest, scope: RequestScope): Promise<void>;
}
