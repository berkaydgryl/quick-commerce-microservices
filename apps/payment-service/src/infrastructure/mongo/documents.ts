/**
 * Odeme koleksiyonunun Mongo'daki SEKLI.
 *
 * Domain tipinden ayri tutulur: alan adi ya da saklama bicimi degisirse domain
 * ve use-case'ler etkilenmez. Ceviri tek yerdedir: mappers.ts. Alan adlari
 * roadmap "MongoDB Veri Modeli" tablosuyla ayni (threeDS, attempts[]).
 */

import type { ErrorCode } from '@getir/core';
import type { BaseDocument } from '@getir/mongo-kit';

import type {
  AttemptKind,
  AttemptOutcome,
  PaymentMethod,
  PaymentStatus,
  ThreeDsCloseReason,
} from '../../domain/payment.js';

export const COLLECTIONS = {
  PAYMENTS: 'payments',
} as const;

export interface ThreeDsDocument {
  challengeId: string;
  expiresAt: Date;
  failedAttempts: number;
  /** Dogrulama kapanmadiysa alan HIC yazilmaz (null degil). */
  closedReason?: ThreeDsCloseReason;
}

export interface AttemptDocument {
  kind: AttemptKind;
  outcome: AttemptOutcome;
  at: Date;
}

/** _id odeme kimligidir (pay_...). Kart verisi ve 3DS kodu bu belgede YOKTUR. */
export interface PaymentDocument extends BaseDocument {
  orderId: string;
  userId: string;
  amount: { amountMinor: number; currency: string };
  method: PaymentMethod;
  status: PaymentStatus;
  failureCode?: ErrorCode;
  threeDS?: ThreeDsDocument;
  attempts: AttemptDocument[];
  idempotencyKey: string;
  /** Iyimser kilit surumu; guncelleme filtresi bunu kosul olarak kullanir. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
