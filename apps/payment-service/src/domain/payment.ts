/**
 * Odeme alaninin varliklari ve saf kurallari.
 *
 * KURAL: bu dosya DISARI BAKMAZ - grpc, uretilen proto tipi ya da veritabani
 * importu yoktur. Durumlar proto'daki PaymentStatus ile birebir ayni
 * sozluktur; ceviri interfaces/grpc/mappers.ts'tedir.
 */

import { ERROR_CODES, ID_PREFIX, newId } from '@getir/core';
import type { Clock, ErrorCode } from '@getir/core';

import type { ProviderDecision } from './payment-provider.js';

export const PAYMENT_STATUS = {
  /** Cekim baslatildi, sonuc belli degil. Kapida odemede teslimata kadar bu durumdadir. */
  PENDING: 'PENDING',
  /** 3DS dogrulamasi bekleniyor; tutar henuz cekilmedi. */
  REQUIRES_3DS: 'REQUIRES_3DS',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_METHOD = {
  CARD: 'CARD',
  CASH_ON_DELIVERY: 'CASH_ON_DELIVERY',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

/** Denemenin hangi adimda yapildigi. */
export const ATTEMPT_KIND = {
  CHARGE: 'CHARGE',
  THREEDS: 'THREEDS',
} as const;

export type AttemptKind = (typeof ATTEMPT_KIND)[keyof typeof ATTEMPT_KIND];

/** Denemenin sonucu. CHARGE icin ilk dordu, THREEDS icin son ucu kullanilir. */
export const ATTEMPT_OUTCOME = {
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
  CHALLENGE_REQUIRED: 'CHALLENGE_REQUIRED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  CODE_ACCEPTED: 'CODE_ACCEPTED',
  CODE_REJECTED: 'CODE_REJECTED',
  EXPIRED: 'EXPIRED',
} as const;

export type AttemptOutcome = (typeof ATTEMPT_OUTCOME)[keyof typeof ATTEMPT_OUTCOME];

export interface PaymentAttempt {
  readonly kind: AttemptKind;
  readonly outcome: AttemptOutcome;
  readonly at: Date;
}

/** Tutar kurus cinsinden tam sayidir; float yoktur. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

/**
 * 3DS dogrulamasinin neden kapandigi (yalnizca FAILED odemede dolu).
 * Kapanan dogrulamaya gelen tekrar istek ayni sebebi yeniden gorur.
 */
export const THREEDS_CLOSE_REASON = {
  EXPIRED: 'expired',
  ATTEMPTS_EXHAUSTED: 'attempts_exhausted',
} as const;

export type ThreeDsCloseReason = (typeof THREEDS_CLOSE_REASON)[keyof typeof THREEDS_CLOSE_REASON];

/**
 * 3DS dogrulamasi. Jeton Confirm3Ds cagrisina oldugu gibi geri verilir.
 * Odeme sonuclandiktan sonra da kayitta KALIR: ayni jetonla gelen tekrar
 * istek (ag kaybi) sonucu yeniden gorebilsin (T5.2).
 */
export interface ThreeDsChallenge {
  readonly id: string;
  readonly expiresAt: Date;
  /** Yanlis kod sayisi; sinira ulasinca dogrulama kilitlenir. */
  readonly failedAttempts: number;
  readonly closedReason?: ThreeDsCloseReason;
}

export interface Payment {
  readonly id: string;
  /** Bir siparisin en fazla bir odemesi olur. */
  readonly orderId: string;
  readonly userId: string;
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  /** Yalnizca FAILED durumunda dolu; ERROR_CODES sozlugunden bir anahtar. */
  readonly failureCode?: ErrorCode;
  /** 3DS istenen odemede dolu; sonuclandiktan sonra da kalir (tekrar istek icin). */
  readonly challenge?: ThreeDsChallenge;
  /**
   * Denetim gecmisi (T5.3): odemede olan her karar, eskiden yeniye. Durumu
   * degistirmeyen istekler (tekrar istek, bicimi bozuk kod, ulasilamayan
   * banka) kayit EKLEMEZ. Girilen 3DS kodu hicbir kayitta tutulmaz.
   */
  readonly attempts: readonly PaymentAttempt[];
  /** Cekimi baslatan niyetin anahtari (ADR-08); ayni anahtar ayni kaydi doner. */
  readonly idempotencyKey: string;
  /**
   * Iyimser kilit: her durum gecisi bir artirir, depo yazarken beklenen surumu
   * karsilastirir. Ayni dogrulamaya es zamanli iki deneme tek hak yakamaz.
   */
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

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

/** Gecmise bir deneme ekler; kayit degismez (yeni nesne doner). */
export function withAttempt(
  payment: Payment,
  kind: AttemptKind,
  outcome: AttemptOutcome,
  at: Date,
): Payment {
  return { ...payment, attempts: [...payment.attempts, { kind, outcome, at }] };
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
