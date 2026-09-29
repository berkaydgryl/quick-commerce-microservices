/**
 * Use-case: bir marketin verilen SKU'larinin satilabilir adetleri (T9.1, B27).
 *
 * Kurallar:
 *  - TOPLU: tek cagrida tek okuma (sayaclar ayni hash-tag'de; Redis'te tek MGET).
 *  - Sayaci olmayan SKU `unknownSkus`'a duser: sessizce ATLANMAZ, cagiran
 *    "bu markette satilmiyor" ile "tukendi" (0) ayrimini ancak boyle yapar.
 *  - Bicimi bozuk SKU da `unknownSkus`'tadir: toplu okumada tek hatali kalem
 *    butun listeyi dusurmemeli (catalog BatchGetOffers ile ayni kural).
 *  - Bilinmeyen market HATA DEGILDIR: marketin varligi katalogun isidir; stok
 *    servisi o markette sayac bulamaz, SKU'lar `unknownSkus`'a duser.
 *  - Tekrarlanan SKU tek sayilir; cevap istek sirasini korur.
 *  - Bu bir REZERVASYON DEGILDIR: okundugu an dogrudur (inventory.proto).
 */

import { isSku } from '@getir/core';

import type { StockCounterReader } from '../domain/stock.js';

export interface CheckAvailabilityDeps {
  readonly counters: StockCounterReader;
}

export interface CheckAvailabilityInput {
  readonly marketId: string;
  readonly skus: readonly string[];
}

export interface SkuAvailability {
  readonly sku: string;
  /** Satilabilir adet; asla negatif degil. */
  readonly availableQuantity: number;
}

export interface CheckAvailabilityResult {
  /** Sayaci olan SKU'lar, istek sirasinda. */
  readonly items: readonly SkuAvailability[];
  /** Bu markette sayaci olmayan (ya da bicimi bozuk) SKU'lar, istek sirasinda. */
  readonly unknownSkus: readonly string[];
}

export type CheckAvailability = (input: CheckAvailabilityInput) => Promise<CheckAvailabilityResult>;

export function createCheckAvailability(deps: CheckAvailabilityDeps): CheckAvailability {
  return async ({ marketId, skus }) => {
    const unique = [...new Set(skus)];
    const readable = unique.filter(isSku);
    const counts =
      readable.length === 0
        ? new Map<string, number>()
        : await deps.counters.available(marketId, readable);

    const items: SkuAvailability[] = [];
    const unknownSkus: string[] = [];
    for (const sku of unique) {
      const count = counts.get(sku);
      if (count === undefined) {
        unknownSkus.push(sku);
      } else {
        items.push({ sku, availableQuantity: count });
      }
    }
    return { items, unknownSkus };
  };
}
