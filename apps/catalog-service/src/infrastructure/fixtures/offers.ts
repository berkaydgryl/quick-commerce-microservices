/**
 * Demo verisi: teklifler (market x urun -> fiyat). ADR-15.
 *
 * Iki kaynak, bu sirayla:
 *   1. Acik fiyat tablolari (offers/price-lists.ts; T4.8, T11.11): oldugu gibi.
 *   2. Cesitlilik (07.10): marketin cesidinde (assortments.ts) olup acik
 *      tabloda olmayan her urun, taban fiyat x marka endeksiyle
 *      (offers/base-prices.ts). Acik fiyat her zaman ustundur.
 * Ayni urun marketten markete farkli fiyattadir; bir marketin satmadigi urun
 * teklif listesinde yoktur.
 */

import type { OfferSeed } from '../../domain/catalog-snapshot.js';
import { assortmentOf } from './assortments.js';
import { MARKETS } from './markets.js';
import { BASE_PRICES, brandPrice } from './offers/base-prices.js';
import { PRICE_LISTS } from './offers/price-lists.js';
import { productIdOf } from './products/product.js';

/** Satistan kaldirilmis teklifler: listede gorunur, "satista degil" (gizlenmez). */
const INACTIVE_OFFERS: ReadonlySet<string> = new Set(['mkt_migros-jet-moda/prd_camasir-suyu']);

/** Acik tablolarin teklifleri, tablo sirasiyla (07.10 oncesi teklifin tamami). */
export const EXPLICIT_OFFERS: readonly OfferSeed[] = Object.entries(PRICE_LISTS).flatMap(
  ([marketId, prices]) =>
    Object.entries(prices).map(([productId, priceMinor]) => ({
      marketId,
      productId,
      priceMinor,
      isActive: !INACTIVE_OFFERS.has(`${marketId}/${productId}`),
    })),
);

/** Cesitten gelen ek teklifler: acik tabloda olmayan market-urun ciftleri. */
const ASSORTMENT_OFFERS: readonly OfferSeed[] = MARKETS.flatMap((market) => {
  const explicit = PRICE_LISTS[market.id] ?? {};
  return assortmentOf(market.id)
    .filter((sku) => explicit[productIdOf(sku)] === undefined)
    .map((sku) => ({
      marketId: market.id,
      productId: productIdOf(sku),
      priceMinor: brandPrice(basePriceOf(sku), market.brand),
      isActive: true,
    }));
});

function basePriceOf(sku: string): number {
  const base = BASE_PRICES[sku];
  if (base === undefined) {
    throw new Error(`taban fiyati olmayan urun: ${sku}`);
  }
  return base;
}

export const OFFERS: readonly OfferSeed[] = [...EXPLICIT_OFFERS, ...ASSORTMENT_OFFERS];
