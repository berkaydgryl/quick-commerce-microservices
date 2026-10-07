/**
 * Odeme koleksiyonunun Mongo'daki SEKLI.
 *
 * Domain tipinden ayri tutulur: alan adi ya da saklama bicimi degisirse domain
 * ve use-case'ler etkilenmez. Ceviri tek yerdedir: mappers.ts. Alan adlari
 * roadmap "MongoDB Veri Modeli" tablosuyla ayni (threeDS, attempts[]).
 */

import type { CardBrand } from '@getir/contracts';
import type { ErrorCode } from '@getir/core';
import type { BaseDocument } from '@getir/mongo-kit';

import type { CardStatus } from '../../domain/card.js';
import type {
  AttemptKind,
  AttemptOutcome,
  PaymentMethod,
  PaymentStatus,
  ThreeDsCloseReason,
} from '../../domain/payment.js';

export const COLLECTIONS = {
  PAYMENTS: 'payments',
  /** Kart kasasi (T11.17): maskeli kayitli kartlar. */
  CARDS: 'cards',
  /** Kart kasasi: kullanici basina kart sayaci (kasa siniri, transaction). */
  CARD_WALLETS: 'card_wallets',
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
  /** Yalnizca iade edilmis odemede yazilir. */
  refundReason?: string;
  /** Yalnizca iptal edilmis (tahsil edilmeden kapatilmis) odemede yazilir (T11.2 PR 3). */
  cancelReason?: string;
  /** Kayitli kartla odemede kartin kimligi (T12.4); jeton YOK. */
  cardId?: string;
  attempts: AttemptDocument[];
  idempotencyKey: string;
  /** Iyimser kilit surumu; guncelleme filtresi bunu kosul olarak kullanir. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Kayitli kart (T11.17). _id kart kimligidir (crd_...). TAM KART NUMARASI VE
 * CVV BU BELGEDE YOKTUR: yalnizca ilk 4 ve son 4 hane.
 */
export interface CardDocument extends BaseDocument {
  userId: string;
  brand: CardBrand;
  first4: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  holderName: string;
  /** Kart adi verilmediyse alan HIC yazilmaz. */
  nickname?: string;
  /** Saglayicinin jetonu: yalnizca ACTIVE kartta; silmede alan kaldirilir. */
  providerToken?: string;
  status: CardStatus;
  createdAt: Date;
  /** Yalnizca silinmis kartta. */
  deletedAt?: Date;
}

/**
 * Kullanicinin kart sayaci (T11.17): _id kullanici kimligidir. `count` silinmemis
 * kart sayisidir; ekleme ve silme kartla AYNI transaction'da degistirir. Sayac
 * es zamanli eklemeleri ayni belgede carpistirir: "say, sonra ekle" anlik goruntu
 * yalitiminda ikisini birden gecirirdi (write skew) ve sinir asilirdi.
 */
export interface CardWalletDocument extends BaseDocument {
  count: number;
}
