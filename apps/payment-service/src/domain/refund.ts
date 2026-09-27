/**
 * Iade kurallari (saf): siparis saga'sinin telafi adimi (T7.1).
 *
 * Iade YALNIZCA tamamlanmis cekime yapilir. Bekleyen (PENDING, REQUIRES_3DS)
 * ya da basarisiz odemede geri verilecek para yoktur; istek CONFLICT alir ki
 * saga "iade edildi" sanip yanlis kayit tutmasin. Zaten iade edilmis odeme
 * tekrar-istek sayilir (ag kaybi): ikinci kez iade yapilmaz.
 */

import { AppError } from '@getir/core';
import type { Clock } from '@getir/core';

import { ATTEMPT_KIND, ATTEMPT_OUTCOME, PAYMENT_STATUS, withAttempt } from './payment.js';
import type { Payment } from './payment.js';

/** Odeme zaten iade edilmis mi? (tekrar istek: ayni sonuc, yazma yok) */
export function isRefunded(payment: Payment): boolean {
  return payment.status === PAYMENT_STATUS.REFUNDED;
}

/**
 * Tamamlanmis cekimi REFUNDED yapar; gecmise deneme, kayda gerekce eklenir.
 * @throws AppError CONFLICT - odeme SUCCEEDED degil (geri verilecek tutar yok).
 */
export function refundPayment(payment: Payment, reason: string, clock: Clock): Payment {
  if (payment.status !== PAYMENT_STATUS.SUCCEEDED) {
    throw AppError.conflict('Iade edilecek tamamlanmis cekim yok', {
      details: { orderId: payment.orderId, status: payment.status },
    });
  }
  const now = clock.date();
  return {
    ...withAttempt(payment, ATTEMPT_KIND.REFUND, ATTEMPT_OUTCOME.REFUNDED, now),
    status: PAYMENT_STATUS.REFUNDED,
    refundReason: reason,
    version: payment.version + 1,
    updatedAt: now,
  };
}
