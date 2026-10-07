/**
 * Odeme alaninin SOZLUGU ve VARLIKLARI: durumlar, yontemler, deneme gecmisi,
 * Payment kaydi. Adimlarin kurallari kendi dosyalarindadir (D9): cekim
 * charge.ts, 3DS three-ds.ts, iade refund.ts, iptal cancel.ts (T11.2 PR 3). Uc adimin ortak yardimcisi
 * (withAttempt) burada durur.
 *
 * KURAL: bu dosya DISARI BAKMAZ - grpc, uretilen proto tipi ya da veritabani
 * importu yoktur. Durumlar proto'daki PaymentStatus ile birebir ayni
 * sozluktur; ceviri interfaces/grpc/mappers.ts'tedir.
 */

import type { ErrorCode } from '@getir/core';

export const PAYMENT_STATUS = {
  /** Cekim baslatildi, sonuc belli degil. Kapida odemede teslimata kadar bu durumdadir. */
  PENDING: 'PENDING',
  /** 3DS dogrulamasi bekleniyor; tutar henuz cekilmedi. */
  REQUIRES_3DS: 'REQUIRES_3DS',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  /** Tahsil edilmeden kapatildi: siparis iptal edildi (T11.2 PR 3). Para hic alinmadi. */
  CANCELLED: 'CANCELLED',
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
  /** Siparis saga'sinin telafi adimi (T7.1): cekilen tutar geri verildi. */
  REFUND: 'REFUND',
  /** Siparis iptal edildi, tahsil edilmemis odeme kapatildi (T11.2 PR 3). */
  CANCEL: 'CANCEL',
} as const;

export type AttemptKind = (typeof ATTEMPT_KIND)[keyof typeof ATTEMPT_KIND];

/** Denemenin sonucu. CHARGE icin ilk dordu, THREEDS icin sonraki ucu, REFUND ve CANCEL icin son ikisi. */
export const ATTEMPT_OUTCOME = {
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
  CHALLENGE_REQUIRED: 'CHALLENGE_REQUIRED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  CODE_ACCEPTED: 'CODE_ACCEPTED',
  CODE_REJECTED: 'CODE_REJECTED',
  EXPIRED: 'EXPIRED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
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
  /** Yalnizca REFUNDED durumunda dolu: iadeyi isteyen tarafin gerekce anahtari. */
  readonly refundReason?: string;
  /** Yalnizca CANCELLED durumunda dolu: iptali isteyen tarafin gerekce anahtari. */
  readonly cancelReason?: string;
  /**
   * Kayitli kartla odemede kasadaki kartin kimligi (T12.4; iz icin). Saglayici
   * jetonu kayda HICBIR ZAMAN yazilmaz.
   */
  readonly cardId?: string;
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

/** Gecmise bir deneme ekler; kayit degismez (yeni nesne doner). */
export function withAttempt(
  payment: Payment,
  kind: AttemptKind,
  outcome: AttemptOutcome,
  at: Date,
): Payment {
  return { ...payment, attempts: [...payment.attempts, { kind, outcome, at }] };
}
