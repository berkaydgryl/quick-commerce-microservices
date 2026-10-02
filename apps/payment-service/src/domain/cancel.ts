/**
 * Iptal kurallari (saf; T11.2 PR 3): siparis iptal edildi, tahsil edilmemis
 * odeme kapatilir.
 *
 * Order odeme yontemini bilmez; siparis odeme asamasindan CANCELLED'a her
 * gectiginde komut gonderir, karari burasi verir:
 *   - kapida odeme PENDING (tutar teslimatta alinacakti) ve 3DS bekleyen kart
 *     -> CANCELLED: para hic alinmadi, iade yok;
 *   - zaten CANCELLED -> tekrar istek, yazilmaz;
 *   - SUCCEEDED, REFUNDED, FAILED -> dokunulmaz: parasi alinmissa iade ayri
 *     akistir (refund.ts), digerlerinde kapatilacak bir sey yok;
 *   - kart cekimi hala PENDING -> sonucu belli degil; komut sonra yeniden denenir.
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
