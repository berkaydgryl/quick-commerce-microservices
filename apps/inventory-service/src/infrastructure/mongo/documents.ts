/**
 * Stok servisinin Mongo belgeleri (ADR-05: koleksiyonlarin sahibi bu servis).
 */

import type { BaseDocument } from '@getir/mongo-kit';

import type { LedgerKind } from '../../domain/stock-ledger.js';

export const COLLECTIONS = {
  STOCK: 'stock',
  STOCK_LEDGER: 'stock_ledger',
} as const;

/**
 * `stock`: market x SKU icin eldeki adet (roadmap veri modeli).
 *
 * `_id` = "market/sku": dogal anahtar. Seed ve yeniden yazim ayni kaydi
 * bulur, ikinci bir kimlik ureticisine gerek kalmaz. (marketId, sku) ayrica
 * benzersiz indekslidir (sorgu ve kural ayni yerde).
 */
export interface StockDocument extends BaseDocument {
  marketId: string;
  sku: string;
  onHand: number;
  /** Iyimser kilit (T10.2: Redis -> Mongo yazimi surum eslesmezse yeniden dener). */
  version: number;
  updatedAt: Date;
}

export function stockDocumentId(marketId: string, sku: string): string {
  return `${marketId}/${sku}`;
}

/**
 * `stock_ledger`: her stok hareketinin degismez kaydi (T10.2, ADR-18; alanlar
 * domain/stock-ledger.ts LedgerEntry).
 *
 * `_id` DOGAL ANAHTARDIR (domain/stock-ledger.ts ledgerEntryId): siparis
 * hareketinde "siparis/sku/tur", acilista "opening/market/sku". Ayni hareket
 * ikinci kez yazilirsa ayni `_id`'ye duser ve yazilmaz (B14: cift kayit
 * olusmaz); ayri bir benzersiz indeks gerekmez.
 */
export interface StockLedgerDocument extends BaseDocument {
  marketId: string;
  sku: string;
  kind: LedgerKind;
  delta: number;
  quantity: number;
  reason: string;
  /** Siparis hareketlerinde; acilis kaydinda yok. */
  orderId?: string;
  createdAt: Date;
}
