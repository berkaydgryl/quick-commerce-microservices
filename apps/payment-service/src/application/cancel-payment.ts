/**
 * CancelPayment use-case (T11.2 PR 3): iptal edilen siparisin tahsil edilmemis
 * odemesini kapatir; para alinmissa iade eder (T15.3, bekleyen is 134; Refund
 * use-case'i, ayni idempotent yol). Kurallar domain/cancel.ts'te; burasi okur,
 * karar verir, surum kontrollu yazar.
 *
 * Cagiran payment.cancel_requested tuketicisidir. Teslimat en az bir kezdir:
 * ayni komut iki kez gelirse ikincisi "zaten iptal" gorur. Es zamanli bir yazim
 * (orn. ayni anda gelen ikinci komut) surum cakismasi verirse kayit yeniden
 * okunur ve karar yeniden verilir.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { Clock } from '@getir/core';

import { CANCEL_DECISION, cancelPayment, decideCancellation } from '../domain/cancel.js';
import type { Payment } from '../domain/payment.js';
import type { PaymentRepository } from '../domain/payment-repository.js';
import type { Refund } from './refund.js';

export interface CancelPaymentDeps {
  readonly repository: Pick<PaymentRepository, 'findByOrderId' | 'update'>;
  readonly clock: Clock;
  /** Para alinmis odemenin iadesi (refund.ts): tekrar ve yarista tek iade. */
  readonly refund: Refund;
}

export interface CancelPaymentInput {
  readonly orderId: string;
  /** Gerekce anahtari (ornek: order_cancelled); kayda oldugu gibi yazilir. */
  readonly reason: string;
}

export const CANCEL_OUTCOME = {
  CANCELLED: 'cancelled',
  ALREADY_CANCELLED: 'already-cancelled',
  /** Iade edilmis ya da odeme basarisiz: kapatilacak bir sey yok. */
  NOTHING_TO_CANCEL: 'nothing-to-cancel',
  /** Para alinmisti: bu komut iade etti (T15.3). */
  REFUNDED: 'refunded',
  /** Para alinmisti ama o arada baska yol (order'in iadesi) iade etmisti. */
  ALREADY_REFUNDED: 'already-refunded',
  /** O siparis icin hic cekim istenmemis. */
  NO_PAYMENT: 'no-payment',
} as const;

export type CancelOutcome = (typeof CANCEL_OUTCOME)[keyof typeof CANCEL_OUTCOME];

export interface CancelPaymentResult {
  readonly outcome: CancelOutcome;
  /** Kaydin son hali; kayit yoksa tanimsiz. */
  readonly payment?: Payment;
}

/**
 * @throws AppError REQUEST_IN_PROGRESS - kart cekimi hala PENDING: sonucu belli
 *   degil, komut sonra yeniden denenmeli.
 */
export type CancelPayment = (input: CancelPaymentInput) => Promise<CancelPaymentResult>;

/** Surum cakismasinda en fazla bu kadar yeniden okunur. */
const MAX_WRITE_RETRIES = 1;

export function createCancelPayment(deps: CancelPaymentDeps): CancelPayment {
  return async ({ orderId, reason }) => {
    for (let attempt = 0; ; attempt += 1) {
      const payment = await deps.repository.findByOrderId(orderId);
      if (payment === null) {
        return { outcome: CANCEL_OUTCOME.NO_PAYMENT };
      }
      const decision = decideCancellation(payment);
      switch (decision) {
        case CANCEL_DECISION.ALREADY_CANCELLED:
          return { outcome: CANCEL_OUTCOME.ALREADY_CANCELLED, payment };
        case CANCEL_DECISION.NOTHING_TO_CANCEL:
          return { outcome: CANCEL_OUTCOME.NOTHING_TO_CANCEL, payment };
        case CANCEL_DECISION.IN_FLIGHT:
          throw new AppError(ERROR_CODES.REQUEST_IN_PROGRESS, 'Kart cekimi hala isleniyor', {
            details: { orderId },
          });
        case CANCEL_DECISION.REFUND: {
          // Hata firlarsa komut onaylanmaz: yeniden teslim, hak bitince olu olay (ERROR).
          const refunded = await deps.refund({ orderId, reason });
          return {
            outcome: refunded.alreadyRefunded
              ? CANCEL_OUTCOME.ALREADY_REFUNDED
              : CANCEL_OUTCOME.REFUNDED,
            payment: refunded.payment,
          };
        }
        case CANCEL_DECISION.CANCEL:
          break;
      }
      const cancelled = cancelPayment(payment, reason, deps.clock);
      try {
        await deps.repository.update(cancelled, payment.version);
        return { outcome: CANCEL_OUTCOME.CANCELLED, payment: cancelled };
      } catch (error: unknown) {
        if (!isVersionConflict(error) || attempt >= MAX_WRITE_RETRIES) {
          throw error;
        }
      }
    }
  };
}

function isVersionConflict(error: unknown): boolean {
  return error instanceof AppError && error.code === ERROR_CODES.CONFLICT;
}
