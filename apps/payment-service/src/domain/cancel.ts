/**
 * Iptal kurallari (saf; T11.2 PR 3): siparis iptal edildi, tahsil edilmemis
 * odeme kapatilir, alinmis tutar iade edilir.
 *
 * Order odeme yontemini bilmez; siparis odeme asamasindan (AWAITING_PAYMENT,
 * PAID) CANCELLED'a her gectiginde komut gonderir, karari burasi verir.
 * CANCELLED siparisin son durumudur: komut geldiyse siparis bir daha odenmez
 * ve teslim edilmez.
 *   - kapida odeme PENDING (tutar teslimatta alinacakti) ve 3DS bekleyen kart
 *     -> CANCELLED: para hic alinmadi, iade yok;
 *   - SUCCEEDED -> IADE (T15.3; bekleyen is 134): orn. 3DS onayi payment'ta
 *     basarili olurken kullanici iptal etti, onay cevabi order'a ulasmadi.
 *     Order'in kendi iadesiyle (refund_requested, dogrudan Refund) cakisirsa
 *     ikincisi "zaten iade edilmis" gorur (refund.ts);
 *   - zaten CANCELLED -> tekrar istek, yazilmaz;
 *   - REFUNDED, FAILED -> kapatilacak ya da iade edilecek bir sey yok;
 *   - kart cekimi hala PENDING -> sonucu belli degil; komut sonra yeniden
 *     denenir (SUCCEEDED olursa o zaman iade edilir).
 */

import type { Clock } from '@getir/core';

import {
  ATTEMPT_KIND,
  ATTEMPT_OUTCOME,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  withAttempt,
} from './payment.js';
import type { Payment } from './payment.js';

export const CANCEL_DECISION = {
  CANCEL: 'cancel',
  ALREADY_CANCELLED: 'already-cancelled',
  NOTHING_TO_CANCEL: 'nothing-to-cancel',
  IN_FLIGHT: 'in-flight',
  /** Para alinmis: tutar iade edilir (refund.ts, gerekce komutun gerekcesi). */
  REFUND: 'refund',
} as const;

export type CancelDecision = (typeof CANCEL_DECISION)[keyof typeof CANCEL_DECISION];

export function decideCancellation(payment: Payment): CancelDecision {
  switch (payment.status) {
    case PAYMENT_STATUS.CANCELLED:
      return CANCEL_DECISION.ALREADY_CANCELLED;
    case PAYMENT_STATUS.REQUIRES_3DS:
      return CANCEL_DECISION.CANCEL;
    case PAYMENT_STATUS.PENDING:
      return payment.method === PAYMENT_METHOD.CASH_ON_DELIVERY
        ? CANCEL_DECISION.CANCEL
        : CANCEL_DECISION.IN_FLIGHT;
    case PAYMENT_STATUS.SUCCEEDED:
      return CANCEL_DECISION.REFUND;
    case PAYMENT_STATUS.FAILED:
    case PAYMENT_STATUS.REFUNDED:
      return CANCEL_DECISION.NOTHING_TO_CANCEL;
  }
}

/** Tahsil edilmemis odemeyi CANCELLED yapar; gecmise deneme, kayda gerekce eklenir. */
export function cancelPayment(payment: Payment, reason: string, clock: Clock): Payment {
  const now = clock.date();
  return {
    ...withAttempt(payment, ATTEMPT_KIND.CANCEL, ATTEMPT_OUTCOME.CANCELLED, now),
    status: PAYMENT_STATUS.CANCELLED,
    cancelReason: reason,
    version: payment.version + 1,
    updatedAt: now,
  };
}
