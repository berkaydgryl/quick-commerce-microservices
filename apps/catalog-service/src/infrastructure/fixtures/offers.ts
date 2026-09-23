/**
 * Demo verisi: teklifler (market x urun -> fiyat). ADR-15.
 */

import type { OfferSeed } from '../../domain/catalog-snapshot.js';

/**
 * Teklifler: market -> (urun -> fiyat). Ayni urun marketten markete farkli
 * fiyattadir; bir marketin satmadigi urun tabloda yoktur.
 */
const PRICE_LISTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'mkt_migros-jet-moda': {
    'prd_sut-1l': 3490,
    'prd_yumurta-10': 8990,
    'prd_peynir-500': 14990,
    'prd_tereyag-250': 12750,
    'prd_domates-1k': 5990,
    'prd_muz-1k': 7490,
    'prd_elma-1k': 4290,
    'prd_salatalik-1k': 3990,
    'prd_su-5l': 2990,
    'prd_kola-1l': 4590,
    'prd_portakal-suyu-1l': 6490,
    'prd_cikolata-80': 3290,
    'prd_cips-150': 4990,
    'prd_bulasik-deterjan': 6790,
    'prd_camasir-suyu': 5490,
  },
  'mkt_a101-caferaga': {
    'prd_sut-1l': 3210,
    'prd_yumurta-10': 8270,
    'prd_peynir-500': 13790,
    'prd_domates-1k': 5510,
    'prd_muz-1k': 6890,
    'prd_elma-1k': 3950,
    'prd_su-5l': 2750,
    'prd_kola-1l': 4220,
    'prd_cikolata-80': 3030,
    'prd_cips-150': 4590,
    'prd_bulasik-deterjan': 6250,
    'prd_camasir-suyu': 5050,
  },
  'mkt_kardesler-manavi': {
    'prd_domates-1k': 5390,
    'prd_muz-1k': 6740,
    'prd_elma-1k': 3860,
    'prd_salatalik-1k': 3590,
  },
  'mkt_migros-jet-besiktas': {
    'prd_sut-1l': 3490,
    'prd_yumurta-10': 8990,
    'prd_peynir-500': 14990,
    'prd_tereyag-250': 12750,
    'prd_domates-1k': 5990,
    'prd_muz-1k': 7490,
    'prd_elma-1k': 4290,
    'prd_salatalik-1k': 3990,
    'prd_su-5l': 2990,
    'prd_kola-1l': 4590,
    'prd_portakal-suyu-1l': 6490,
    'prd_cikolata-80': 3290,
    'prd_cips-150': 4990,
    'prd_bulasik-deterjan': 6790,
    'prd_camasir-suyu': 5490,
  },
  'mkt_carrefour-express-barbaros': {
    'prd_sut-1l': 3660,
    'prd_yumurta-10': 9440,
    'prd_peynir-500': 15740,
    'prd_tereyag-250': 13390,
    'prd_domates-1k': 6290,
    'prd_muz-1k': 7860,
    'prd_salatalik-1k': 4190,
    'prd_su-5l': 3140,
    'prd_kola-1l': 4820,
    'prd_portakal-suyu-1l': 6810,
    'prd_cikolata-80': 3450,
    'prd_cips-150': 5240,
    'prd_bulasik-deterjan': 7130,
  },
  'mkt_a101-abbasaga': {
    'prd_sut-1l': 3210,
    'prd_yumurta-10': 8270,
    'prd_peynir-500': 13790,
    'prd_domates-1k': 5510,
    'prd_muz-1k': 6890,
    'prd_elma-1k': 3950,
    'prd_su-5l': 2750,
    'prd_kola-1l': 4220,
    'prd_cikolata-80': 3030,
    'prd_cips-150': 4590,
    'prd_bulasik-deterjan': 6250,
    'prd_camasir-suyu': 5050,
  },
};

/** Satistan kaldirilmis teklifler: listede gorunur, "satista degil" (gizlenmez). */
const INACTIVE_OFFERS: ReadonlySet<string> = new Set(['mkt_migros-jet-moda/prd_camasir-suyu']);

export const OFFERS: readonly OfferSeed[] = Object.entries(PRICE_LISTS).flatMap(
  ([marketId, prices]) =>
    Object.entries(prices).map(([productId, priceMinor]) => ({
      marketId,
      productId,
      priceMinor,
      isActive: !INACTIVE_OFFERS.has(`${marketId}/${productId}`),
    })),
);
