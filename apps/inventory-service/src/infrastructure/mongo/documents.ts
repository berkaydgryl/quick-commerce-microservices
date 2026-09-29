/**
 * Stok servisinin Mongo belgeleri (ADR-05: koleksiyonlarin sahibi bu servis).
 */

import type { BaseDocument } from '@getir/mongo-kit';

export const COLLECTIONS = {
  STOCK: 'stock',
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
