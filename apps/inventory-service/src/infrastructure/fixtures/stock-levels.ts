/**
 * Demo stogu (T9.1): market x SKU -> eldeki adet (onHand).
 *
 * Katalogdaki HER teklifin burada bir karsiligi vardir; test bunu katalogun demo
 * verisiyle karsilastirir (test/unit/stock-fixtures.spec.ts). Her servis kendi
 * seed'ini yazar (ADR-05): stok katalogdan okunmaz, kendi tablosundan gelir.
 *
 * Bilerek konan durumlar (web ve gateway bunlarla denenir):
 *   - her markette bir "tukendi" (0) ve bir "son 2 adet" kalemi;
 *   - Migros Jet Moda'da cikolata 1 adet: yaris senaryosu (T11.1, "stok 1, 100
 *     paralel istek").
 * Diger adetler 20-60 arasi ve sabittir: tekrar kosan seed ayni stogu yazar.
 */

import type { StockLevel } from '../../domain/stock.js';

const STOCK_TABLE: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'mkt_migros-jet-moda': {
    'SUT-1L': 24,
    'YUMURTA-10': 36,
    'PEYNIR-500': 2,
    'TEREYAG-250': 48,
    'DOMATES-1K': 30,
    'MUZ-1K': 42,
    'ELMA-1K': 55,
    'SALATALIK-1K': 28,
    'SU-5L': 60,
    'KOLA-1L': 0,
    'PORTAKAL-SUYU-1L': 33,
    'CIKOLATA-80': 1,
    'CIPS-150': 45,
    'BULASIK-DETERJAN': 21,
    'CAMASIR-SUYU': 52,
  },
  'mkt_a101-caferaga': {
    'SUT-1L': 2,
    'YUMURTA-10': 0,
    'PEYNIR-500': 39,
    'DOMATES-1K': 26,
    'MUZ-1K': 57,
    'ELMA-1K': 40,
    'SU-5L': 31,
    'KOLA-1L': 50,
    'CIKOLATA-80': 24,
    'CIPS-150': 36,
    'BULASIK-DETERJAN': 48,
    'CAMASIR-SUYU': 30,
  },
  'mkt_kardesler-manavi': {
    'DOMATES-1K': 42,
    'MUZ-1K': 2,
    'ELMA-1K': 55,
    'SALATALIK-1K': 0,
  },
  'mkt_migros-jet-besiktas': {
    'SUT-1L': 28,
    'YUMURTA-10': 60,
    'PEYNIR-500': 33,
    'TEREYAG-250': 2,
    'DOMATES-1K': 45,
    'MUZ-1K': 21,
    'ELMA-1K': 52,
    'SALATALIK-1K': 39,
    'SU-5L': 26,
    'KOLA-1L': 57,
    'PORTAKAL-SUYU-1L': 0,
    'CIKOLATA-80': 40,
    'CIPS-150': 31,
    'BULASIK-DETERJAN': 50,
    'CAMASIR-SUYU': 24,
  },
  'mkt_carrefour-express-barbaros': {
    'SUT-1L': 36,
    'YUMURTA-10': 48,
    'PEYNIR-500': 30,
    'TEREYAG-250': 42,
    'DOMATES-1K': 2,
    'MUZ-1K': 55,
    'SALATALIK-1K': 28,
    'SU-5L': 60,
    'KOLA-1L': 33,
    'PORTAKAL-SUYU-1L': 45,
    'CIKOLATA-80': 21,
    'CIPS-150': 0,
    'BULASIK-DETERJAN': 52,
  },
  'mkt_a101-abbasaga': {
    'SUT-1L': 39,
    'YUMURTA-10': 26,
    'PEYNIR-500': 57,
    'DOMATES-1K': 40,
    'MUZ-1K': 31,
    'ELMA-1K': 2,
    'SU-5L': 0,
    'KOLA-1L': 50,
    'CIKOLATA-80': 24,
    'CIPS-150': 36,
    'BULASIK-DETERJAN': 48,
    'CAMASIR-SUYU': 30,
  },
};

export const STOCK_LEVELS: readonly StockLevel[] = Object.entries(STOCK_TABLE).flatMap(
  ([marketId, levels]) =>
    Object.entries(levels).map(([sku, onHand]) => ({ marketId, sku, onHand })),
);
