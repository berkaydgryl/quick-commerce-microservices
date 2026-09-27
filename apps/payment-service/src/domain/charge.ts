/**
 * Cekimin saf kurallari (T5.1, T7.1; D9'da payment.ts'ten ayrildi). I/O yok;
 * saat ve 3DS omru parametre olarak gelir.
 *
 * Akis (siralamasi application/charge.ts'te):
 *   startPayment            -> PENDING kayit, saglayicidan ONCE yazilir
 *   withRequiredThreeDs     -> risk 3DS istediyse onay CHALLENGE_REQUIRED olur
 *   settlePayment           -> karar kayda: SUCCEEDED / FAILED / REQUIRES_3DS
 *   failUnreachableProvider -> saglayiciya ulasilamadi: FAILED, tutar cekilmedi
 *   isSameCharge            -> ayni anahtarli tekrar istek ayni niyet mi?
 */

import { ERROR_CODES, ID_PREFIX, newId } from '@getir/core';
import type { Clock } from '@getir/core';

import { ATTEMPT_KIND, ATTEMPT_OUTCOME, PAYMENT_STATUS, withAttempt } from './payment.js';
import type { Money, Payment, PaymentMethod } from './payment.js';
import type { ProviderDecision } from './payment-provider.js';

/** Cekim isteginin domain'e giren hali (dogrulanmis). */
export interface ChargeCommand {
  readonly orderId: string;
  readonly userId: string;
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly idempotencyKey: string;
}

/**
 * Yeni odeme kaydi: PENDING. Saglayiciya gitmeden ONCE yazilir ki ayni siparis
 * ya da ayni anahtarla gelen ikinci istek kaydi gorsun ve ikinci kez cekim
 * yapilmasin (ADR-08: once niyeti isaretle, sonra isi yap).
 */
export function startPayment(command: ChargeCommand, clock: Clock): Payment {
  const now = clock.date();
  return {
    id: newId(ID_PREFIX.PAYMENT),
    ...command,
    status: PAYMENT_STATUS.PENDING,
    attempts: [],
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Saglayici kararini kayda isler. Kart reddi HATA DEGILDIR, normal bir is
 * sonucudur: kayit FAILED + PAYMENT_DECLINED olur ve saga bunu okur.
 */
export function settlePayment(
  payment: Payment,
  decision: ProviderDecision,
  clock: Clock,
  challengeTtlMs: number,
): Payment {
  const now = clock.date();
  const base = {
    ...withAttempt(payment, ATTEMPT_KIND.CHARGE, decision, now),
    version: payment.version + 1,
    updatedAt: now,
  };

  switch (decision) {
    case 'APPROVED':
      return { ...base, status: PAYMENT_STATUS.SUCCEEDED };
    case 'DECLINED':
      return { ...base, status: PAYMENT_STATUS.FAILED, failureCode: ERROR_CODES.PAYMENT_DECLINED };
    case 'CHALLENGE_REQUIRED':
      return {
        ...base,
        status: PAYMENT_STATUS.REQUIRES_3DS,
        challenge: {
          id: newId(ID_PREFIX.THREEDS_CHALLENGE),
          expiresAt: new Date(now.getTime() + challengeTtlMs),
          failedAttempts: 0,
        },
      };
  }
}

/**
 * Risk'in "3DS zorunlu" karari (T7.1, orta bant): banka onaylayacak olsa bile
 * dogrulama istenir. Karar risk'e aittir, payment yalnizca uygular. Ret ve
 * zaten dogrulama isteyen karar degismez: reddedilecek kart 3DS'e gitmez.
 */
export function withRequiredThreeDs(
  decision: ProviderDecision,
  requireThreeDs: boolean,
): ProviderDecision {
  return requireThreeDs && decision === 'APPROVED' ? 'CHALLENGE_REQUIRED' : decision;
}

/**
 * Cekimde saglayiciya ulasilamadi: tutar CEKILMEDI, kayit FAILED olur.
 * PENDING'de birakilsaydi ayni anahtarla gelen tekrar istek hep "sonuc belli
 * degil" gorur ve siparis sonsuza kadar beklerdi.
 */
export function failUnreachableProvider(payment: Payment, clock: Clock): Payment {
  const now = clock.date();
  return {
    ...withAttempt(payment, ATTEMPT_KIND.CHARGE, ATTEMPT_OUTCOME.PROVIDER_ERROR, now),
    status: PAYMENT_STATUS.FAILED,
    failureCode: ERROR_CODES.SERVICE_UNAVAILABLE,
    version: payment.version + 1,
    updatedAt: now,
  };
}

/**
 * Ayni idempotency anahtariyla gelen ikinci istek AYNI niyet mi?
 * Anahtar ayni ama siparis, tutar ya da yontem farkliysa istemci anahtari
 * yanlis kullaniyordur; ilk kaydi donmek yanlis tutari onaylamak olurdu.
 */
export function isSameCharge(payment: Payment, command: ChargeCommand): boolean {
  return (
    payment.orderId === command.orderId &&
    payment.userId === command.userId &&
    payment.method === command.method &&
    payment.amount.amountMinor === command.amount.amountMinor &&
    payment.amount.currency === command.amount.currency
  );
}
