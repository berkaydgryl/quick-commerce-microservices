/**
 * 3DS dogrulamasinin saf kurallari (T5.2). I/O yok; saat ve deneme siniri
 * parametre olarak gelir, boylece her kural sabit saatle test edilir.
 *
 * Matris:
 *   dogru kod            -> SUCCEEDED
 *   yanlis kod (1., 2.)  -> REQUIRES_3DS kalir, hak azalir
 *   yanlis kod (son hak) -> FAILED, dogrulama kilitlenir (attempts_exhausted)
 *   sure doldu           -> FAILED (expired); kod bakilmaz
 */

import { ERROR_CODES } from '@getir/core';
import type { Clock } from '@getir/core';

import { PAYMENT_STATUS, THREEDS_CLOSE_REASON } from './payment.js';
import type { Payment, ThreeDsChallenge, ThreeDsCloseReason } from './payment.js';

/** Dogrulamanin sonucu: ya tamamlandi ya da reddedildi (kalan hakla). */
export type ThreeDsOutcome =
  | { readonly kind: 'succeeded'; readonly payment: Payment }
  | {
      readonly kind: 'rejected';
      readonly payment: Payment;
      readonly attemptsLeft: number;
      /** Yalnizca dogrulama kapandiysa dolu. */
      readonly closedReason?: ThreeDsCloseReason;
    };

/** REQUIRES_3DS odemenin dogrulamasi; yoksa odeme 3DS beklemiyordur. */
export function pendingChallenge(payment: Payment): ThreeDsChallenge | undefined {
  return payment.status === PAYMENT_STATUS.REQUIRES_3DS ? payment.challenge : undefined;
}

/** Sure siniri dahil degil: expiresAt aninda gelen deneme gec kalmistir. */
export function isChallengeExpired(challenge: ThreeDsChallenge, clock: Clock): boolean {
  return clock.now() >= challenge.expiresAt.getTime();
}

/** Suresi dolan dogrulamayi kapatir: odeme FAILED, tutar cekilmedi. */
export function expireChallenge(
  payment: Payment,
  challenge: ThreeDsChallenge,
  clock: Clock,
): ThreeDsOutcome {
  const closed = close(
    payment,
    challenge,
    challenge.failedAttempts,
    THREEDS_CLOSE_REASON.EXPIRED,
    clock,
  );
  return {
    kind: 'rejected',
    payment: closed,
    attemptsLeft: 0,
    closedReason: THREEDS_CLOSE_REASON.EXPIRED,
  };
}

/**
 * Saglayicinin kod karari kayda islenir. Karar disaridan gelir; bu fonksiyon
 * kodu GORMEZ, yalnizca sonucun durum gecisini yazar.
 */
export function applyVerification(
  payment: Payment,
  challenge: ThreeDsChallenge,
  codeAccepted: boolean,
  maxAttempts: number,
  clock: Clock,
): ThreeDsOutcome {
  if (codeAccepted) {
    return {
      kind: 'succeeded',
      payment: { ...next(payment, clock), status: PAYMENT_STATUS.SUCCEEDED },
    };
  }

  const failedAttempts = challenge.failedAttempts + 1;
  const attemptsLeft = Math.max(maxAttempts - failedAttempts, 0);
  if (attemptsLeft === 0) {
    const closed = close(
      payment,
      challenge,
      failedAttempts,
      THREEDS_CLOSE_REASON.ATTEMPTS_EXHAUSTED,
      clock,
    );
    return {
      kind: 'rejected',
      payment: closed,
      attemptsLeft,
      closedReason: THREEDS_CLOSE_REASON.ATTEMPTS_EXHAUSTED,
    };
  }

  return {
    kind: 'rejected',
    payment: { ...next(payment, clock), challenge: { ...challenge, failedAttempts } },
    attemptsLeft,
  };
}

/**
 * Sonuclanmis odemeye ayni jetonla gelen tekrar istek (ag kaybi): durum
 * DEGISMEZ, onceki sonuc yeniden verilir. SUCCEEDED -> basari; kapali
 * dogrulama -> ayni sebeple ret.
 */
export function replayOutcome(payment: Payment): ThreeDsOutcome | undefined {
  if (payment.status === PAYMENT_STATUS.SUCCEEDED) {
    return { kind: 'succeeded', payment };
  }
  const closedReason = payment.challenge?.closedReason;
  if (payment.status === PAYMENT_STATUS.FAILED && closedReason !== undefined) {
    return { kind: 'rejected', payment, attemptsLeft: 0, closedReason };
  }
  return undefined;
}

function next(payment: Payment, clock: Clock): Payment {
  return { ...payment, version: payment.version + 1, updatedAt: clock.date() };
}

function close(
  payment: Payment,
  challenge: ThreeDsChallenge,
  failedAttempts: number,
  closedReason: ThreeDsCloseReason,
  clock: Clock,
): Payment {
  return {
    ...next(payment, clock),
    status: PAYMENT_STATUS.FAILED,
    failureCode: ERROR_CODES.THREEDS_FAILED,
    challenge: { ...challenge, failedAttempts, closedReason },
  };
}
