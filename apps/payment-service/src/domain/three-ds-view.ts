/**
 * Odemenin 3DS durumunun gorunumu (#163 B1; GetPayment three_ds): siparis
 * ayrintisi bunu kullanicinin sayfasina tasir, sayfa yenilense de dogrulama
 * surdurulur. Saf: saat ve hak siniri parametredir; 3DS kurallari three-ds.ts'ten.
 *
 * VAR: odeme 3DS bekliyor (REQUIRES_3DS: acik ya da suresi dolmus, henuz
 * kapatilmamis) ya da dogrulamasi kapanip FAILED oldu (suresi doldu, hakki bitti).
 * YOK: dogrulama hic baslamadi ya da odeme 3DS disinda sonuclandi (basarili,
 * iade, iptal, kart reddi).
 *
 * challengeId yalnizca dogrulama ACIKKEN: REQUIRES_3DS, kapanmamis, hakki var ve
 * suresi (payment'in saatiyle, Confirm3Ds ile ayni sinir) dolmamis. attemptsLeft:
 * three-ds.ts remainingAttempts (hakki bitene her zaman 0; suresi dolanda kalan
 * hak; Confirm3Ds hata ayrintisindaki "expired -> 0" kapanisi anlatir, bu degil).
 *
 * GUVENLIK: challengeId bir YETENEK JETONUDUR (kullanicinin oturumuyla kod
 * girmeye yeter): gunluge, hata ayrintisina ve metrik etiketine HICBIR ZAMAN
 * yazilmaz. Kod (OTP) zaten hicbir kayitta yoktur.
 */

import type { Clock } from '@getir/core';

import type { Payment } from './payment.js';
import {
  closedChallenge,
  isChallengeExpired,
  pendingChallenge,
  remainingAttempts,
} from './three-ds.js';

/** Alan adlari proto ThreeDsStatus'a yakin ama jeton istege bagli (bos metin degil). */
export interface ThreeDsView {
  /** Yalnizca dogrulama acikken. */
  readonly challengeId?: string;
  readonly expiresAt: Date;
  readonly attemptsLeft: number;
}

export function threeDsViewOf(
  payment: Payment,
  maxAttempts: number,
  clock: Clock,
): ThreeDsView | undefined {
  const waiting = pendingChallenge(payment);
  const challenge = waiting ?? closedChallenge(payment);
  if (challenge === undefined) {
    return undefined;
  }
  const attemptsLeft = remainingAttempts(challenge, maxAttempts);
  const open =
    waiting !== undefined &&
    challenge.closedReason === undefined &&
    attemptsLeft > 0 &&
    !isChallengeExpired(challenge, clock);
  return {
    ...(open ? { challengeId: challenge.id } : {}),
    expiresAt: challenge.expiresAt,
    attemptsLeft,
  };
}
