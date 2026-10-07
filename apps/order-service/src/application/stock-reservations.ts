/**
 * inventory-svc PORTU (T11.2): siparisin stok kilidi. Uygulamasi
 * infrastructure/inventory'de (gRPC); testlerde sahtesi verilir.
 *
 * Reserve, Commit, Release ve kisaltma siparis kimligiyle IDEMPOTENT'tir
 * (inventory, ADR-08): tekrar gelen Reserve sayaci ikinci kez dusmez, Commit ve
 * Release stoku bir kez hareket ettirir, kisaltma ayni sinira iner. Uzatma
 * BEKLENEN BITISLE tekrar guvenlidir (T15.3; bekleyen is 117, QA IQ3): kilidin
 * bitisi siparisin bildigiyle tutmazsa inventory sureye dokunmaz, hak harcamaz
 * ve guncel bitisi doner (`moved`); cevabi kaybolan uzatmanin tekrari hakki
 * ikinci kez yakmaz.
 *
 * Beklenen sonuclar (stok yetmedi, kullanicinin baska aktif kilidi var) HATA
 * DEGIL sonuc olarak doner: saga onlara gore karar verir. Ulasilamama ve
 * gecersiz istek hata firlatir.
 */

import type { AppError } from '@getir/core';

import type { ReleaseReason } from '../domain/stock-reservation.js';
import type { RequestScope } from './request-scope.js';

export interface StockLine {
  readonly sku: string;
  readonly quantity: number;
}

export interface ReserveStockRequest {
  readonly orderId: string;
  readonly userId: string;
  readonly marketId: string;
  readonly lines: readonly StockLine[];
  readonly ttlSeconds: number;
}

export type ReserveStockOutcome =
  | { readonly kind: 'reserved'; readonly expiresAt: Date }
  /** inventory'nin kendi hatasi (sku, requested, available): istemciye AYNEN gider. */
  | { readonly kind: 'insufficient'; readonly error: AppError }
  /**
   * Kullanicinin baska bir siparisi stok tutuyor (B22); kimligiyle. Kimlik
   * inventory'nin kullanici kilidinden gelir, istekten DEGIL. `activeExpiresInMs`:
   * o kilidin kalan omru (T15.3, bekleyen is 126); eski inventory gondermez ya da
   * gecersizse undefined (bilinmiyor).
   */
  | {
      readonly kind: 'user-has-active';
      readonly activeOrderId: string;
      readonly activeExpiresInMs?: number | undefined;
      readonly error: AppError;
    };

export const SETTLEMENT = {
  /** Bu cagri stoku hareket ettirdi. */
  APPLIED: 'applied',
  /** Daha once ayni sonuca baglanmisti; stok tekrar hareket etmedi. */
  ALREADY_APPLIED: 'already-applied',
  /** Kilit yok: suresi dolup birakilmis ya da hic alinmamis. */
  NOT_FOUND: 'not-found',
} as const;

export type Settlement = (typeof SETTLEMENT)[keyof typeof SETTLEMENT];

export interface SettleStockRequest {
  readonly orderId: string;
  readonly marketId: string;
}

export interface ReleaseStockRequest extends SettleStockRequest {
  readonly reason: ReleaseReason;
}

export interface ExtendLockRequest extends SettleStockRequest {
  readonly additionalSeconds: number;
  /** Siparisin bildigi kilit bitisi (T15.3): inventory'nin bir onceki cevabindan. */
  readonly expectedExpiresAt: Date;
}

export interface ShortenLockRequest extends SettleStockRequest {
  readonly maxRemainingSeconds: number;
}

/**
 * Kilidin suresini ayarlayan cagrilarin sonucu (T11.3). Kilidin dusmus olmasi
 * (inventory RESERVATION_EXPIRED) HATA DEGIL sonuctur: saga siparisi iptal eder.
 */
export type LockTiming =
  /** Kilit duruyor; `changed`: bu cagri sureyi degistirdi (uzatma hakki bitmis ya da zaten kisa ise false). */
  | { readonly kind: 'active'; readonly expiresAt: Date; readonly changed: boolean }
  /** Kilit yok: birakilmis, onaylanmis ya da bitis ani gecmis. */
  | { readonly kind: 'lapsed' };

/**
 * Uzatmanin sonucu (T15.3): kilit zamanlamasi ya da `moved`. moved: kilidin
 * bitisi siparisin bildiginden farkli (cevabi kaybolan bir uzatma ya da
 * kaydedilmemis bir kisaltma); bu cagri sureye DOKUNMADI, hak harcamadi.
 * `expiresAt` kilidin guncel bitisidir.
 */
export type ExtendTiming = LockTiming | { readonly kind: 'moved'; readonly expiresAt: Date };

export interface StockReservations {
  reserve(request: ReserveStockRequest, scope: RequestScope): Promise<ReserveStockOutcome>;
  commit(request: SettleStockRequest, scope: RequestScope): Promise<Settlement>;
  release(request: ReleaseStockRequest, scope: RequestScope): Promise<Settlement>;
  /** Bitis anini ileri alir; inventory'de rezervasyon basina en cok 3 kez (B21). */
  extend(request: ExtendLockRequest, scope: RequestScope): Promise<ExtendTiming>;
  /** Kalan sureyi kisaltir; asla uzatmaz. */
  shorten(request: ShortenLockRequest, scope: RequestScope): Promise<LockTiming>;
}
