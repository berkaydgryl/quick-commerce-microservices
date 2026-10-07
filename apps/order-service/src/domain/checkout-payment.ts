/**
 * Saga'nin odeme adimi (T7.1): saf kurallar.
 *
 * Odeme alaninin sahibi payment-svc'dir; burada yalnizca SIPARISIN ihtiyac
 * duydugu goruntu var: yontem, sonucun durumu ve "bu sonuc siparisi nereye
 * goturur" karari. Proto enum'lari infrastructure/payment'ta cevrilir.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { ErrorCode } from '@getir/core';

import { TIMELINE_NOTE } from './order.js';

export const PAYMENT_METHOD = {
  CARD: 'CARD',
  CASH_ON_DELIVERY: 'CASH_ON_DELIVERY',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

/** payment-svc'nin odeme durumlari (proto PaymentStatus ile ayni sozluk). */
export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  REQUIRES_3DS: 'REQUIRES_3DS',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  /** Tahsil edilmeden kapatildi: siparis iptal edildi (T11.2 PR 3). */
  CANCELLED: 'CANCELLED',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

/** Odeme cevabinin siparis icin anlamli kismi. */
export interface PaymentResult {
  readonly status: PaymentStatus;
  /** Yalnizca FAILED'da dolu (PAYMENT_DECLINED, THREEDS_FAILED, SERVICE_UNAVAILABLE). */
  readonly failureCode?: ErrorCode;
  /** Yalnizca REQUIRES_3DS'te dolu: istemci ConfirmPayment'a geri verir. */
  readonly challengeId?: string;
  /** challengeId ile birlikte: 3DS kodunun gecerlilik bitisi (T12.4). */
  readonly challengeExpiresAt?: Date;
}

/** Odeme sonucunun siparise etkisi. */
export type PaymentDecision =
  | { readonly kind: 'paid'; readonly note?: string }
  | { readonly kind: 'awaiting-3ds'; readonly challengeId: string }
  | { readonly kind: 'failed'; readonly code: ErrorCode };

/**
 * @throws AppError REQUEST_IN_PROGRESS - kartli cekim hala PENDING: ayni
 *   siparise es zamanli bir cekim suruyor (tekrar deneme ilk istegin kaydini
 *   gordu). Siparis degismez; istemci biraz sonra tekrar dener.
 * @throws AppError INTERNAL - odeme zaten iade edilmis: odeme adiminda olamaz.
 */
export function decidePayment(
  orderId: string,
  method: PaymentMethod,
  result: PaymentResult,
): PaymentDecision {
  switch (result.status) {
    case PAYMENT_STATUS.SUCCEEDED:
      return { kind: 'paid' };
    case PAYMENT_STATUS.PENDING:
      // Kapida odemede cekim yoktur, kayit teslimata kadar PENDING kalir.
      if (method === PAYMENT_METHOD.CASH_ON_DELIVERY) {
        return { kind: 'paid', note: TIMELINE_NOTE.CASH_ON_DELIVERY };
      }
      throw new AppError(ERROR_CODES.REQUEST_IN_PROGRESS, 'Odeme hala isleniyor', {
        details: { orderId },
      });
    case PAYMENT_STATUS.REQUIRES_3DS:
      if (result.challengeId === undefined) {
        throw AppError.internal('3DS isteyen odemede jeton yok', { details: { orderId } });
      }
      return { kind: 'awaiting-3ds', challengeId: result.challengeId };
    case PAYMENT_STATUS.FAILED:
      return { kind: 'failed', code: result.failureCode ?? ERROR_CODES.PAYMENT_DECLINED };
    case PAYMENT_STATUS.REFUNDED:
      throw AppError.internal('Odeme adiminda iade edilmis odeme', { details: { orderId } });
    case PAYMENT_STATUS.CANCELLED:
      // Odeme yalnizca siparis iptal edildikten sonra kapatilir (T11.2 PR 3);
      // iptal edilmis siparis odeme adimina gelmez.
      throw AppError.internal('Odeme adiminda kapatilmis odeme', { details: { orderId } });
  }
}

/**
 * Cekimin idempotency anahtari SIPARISTEN turetilir: bir siparis asla iki kez
 * cekilmez. Cevap gelmeden baglanti koparsa CreateOrder tekrar denenebilir;
 * ayni anahtarla giden cekim payment-svc'de ilk kaydi doner (ADR-08).
 */
export function chargeIdempotencyKey(orderId: string): string {
  return `charge-${orderId}`;
}

/** Telafi iadesinin anahtari; ayni siparisin iadesi iki kez yapilmaz. */
export function refundIdempotencyKey(orderId: string): string {
  return `refund-${orderId}`;
}

/** Iade gerekcesi anahtarlari (payment-svc kayda oldugu gibi yazar). */
export const REFUND_REASON = {
  /** Cekim basarili oldu ama siparis PAID yazilamadi (ornegin ayni anda iptal edildi). */
  ORDER_CHANGED_DURING_PAYMENT: 'order_changed_during_payment',
  /** Cekim basarili oldu ama stok kilidi o arada dustu (T11.2): siparis iptal. */
  RESERVATION_EXPIRED: 'reservation_expired',
} as const;

export type RefundReason = (typeof REFUND_REASON)[keyof typeof REFUND_REASON];
