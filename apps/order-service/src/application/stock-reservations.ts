/**
 * inventory-svc PORTU (T11.2): siparisin stok kilidi. Uygulamasi
 * infrastructure/inventory'de (gRPC); testlerde sahtesi verilir.
 *
 * Uc cagri da siparis kimligiyle IDEMPOTENT'tir (inventory, ADR-08): ayni
 * siparis icin tekrar gelen Reserve sayaci ikinci kez dusmez, Commit ve
 * Release stoku bir kez hareket ettirir.
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
  /** Kullanicinin baska bir siparisi stok tutuyor (B22); kimligiyle. */
  | { readonly kind: 'user-has-active'; readonly activeOrderId: string; readonly error: AppError };

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

export interface StockReservations {
  reserve(request: ReserveStockRequest, scope: RequestScope): Promise<ReserveStockOutcome>;
  commit(request: SettleStockRequest, scope: RequestScope): Promise<Settlement>;
  release(request: ReleaseStockRequest, scope: RequestScope): Promise<Settlement>;
}
