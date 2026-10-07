/**
 * Demo stogu (T9.1): market x SKU -> eldeki adet (onHand).
 *
 * Katalogdaki HER teklifin burada bir karsiligi vardir; test bunu katalogun demo
 * verisiyle karsilastirir (test/unit/stock-fixtures.spec.ts). Her servis kendi
 * seed'ini yazar (ADR-05): stok katalogdan okunmaz, kendi tablosundan gelir.
 *
 * Iki kaynak, bu sirayla:
 *   1. Acik tablo (stock-table.ts; T9.1, T11.11): oldugu gibi.
 *   2. Cesitlilik (07.10): marketin cesidinde (assortments.ts, katalogla ayni
 *      kopya) olup acik tabloda olmayan her SKU.
 *
 * Bilerek konan durumlar (web ve gateway bunlarla denenir):
 *   - her markette bir "tukendi" (0) ve bir "son 2 adet" kalemi (acik tablosu
 *     olmayan yeni markette cesidinin alfabetik ilk iki SKU'su);
 *   - Migros Jet Moda'da cikolata 1 adet: yaris senaryosu (T11.1, "stok 1, 100
 *     paralel istek").
 * Diger adetler 20-60 arasi ve sabittir (market ve SKU'nun ozetinden): tekrar
 * kosan seed ayni stogu yazar.
 */

import { createHash } from 'node:crypto';

import type { StockLevel } from '../../domain/stock.js';
import { ASSORTMENTS, assortmentOf } from './assortments.js';
import { STOCK_TABLE } from './stock-table.js';

/** Uretilen adetlerin araligi (iki uc dahil). */
const MIN_ON_HAND = 20;
const ON_HAND_SPAN = 41;
/** Acik tablosu olmayan markette bilerek konan adetler: tukendi ve "son 2". */
const SOLD_OUT = 0;
const LAST_FEW = 2;

/** Market ve SKU'nun ozetinden sabit adet (courier fixtures ile ayni yontem). */
function generatedOnHand(marketId: string, sku: string): number {
  const digest = createHash('sha256').update(`stok:${marketId}/${sku}`).digest();
  return MIN_ON_HAND + (digest.readUInt32BE(0) % ON_HAND_SPAN);
}

/** Acik tablonun satirlari, tablo sirasiyla (07.10 oncesi stogun tamami). */
export const EXPLICIT_LEVELS: readonly StockLevel[] = Object.entries(STOCK_TABLE).flatMap(
  ([marketId, levels]) =>
    Object.entries(levels).map(([sku, onHand]) => ({ marketId, sku, onHand })),
);

/** Cesitten gelen ek stok: acik tabloda olmayan market-SKU ciftleri. */
const ASSORTMENT_LEVELS: readonly StockLevel[] = Object.keys(ASSORTMENTS).flatMap((marketId) => {
  const explicit = STOCK_TABLE[marketId];
  return assortmentOf(marketId)
    .filter((sku) => explicit?.[sku] === undefined)
    .map((sku, index) => {
      const special = explicit === undefined ? [SOLD_OUT, LAST_FEW][index] : undefined;
      return { marketId, sku, onHand: special ?? generatedOnHand(marketId, sku) };
    });
});

export const STOCK_LEVELS: readonly StockLevel[] = [...EXPLICIT_LEVELS, ...ASSORTMENT_LEVELS];
