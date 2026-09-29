/**
 * Use-case: hizli sayaclari (Redis) kalici stoktan (Mongo) yazar (ADR-03, T9.2).
 *
 * Iki kullanim:
 *   - acilis (`missing`): yalnizca olmayan sayac yazilir. Var olan sayac
 *     rezervasyonlari yansitir (T10); ezilirse ayrilmis stok yeniden satilirdi.
 *   - reseed (`overwrite`): Redis bosaltildiginda ya da seed sonrasinda hepsi
 *     bastan yazilir. Bilincli bir komuttur (reseed.ts).
 *
 * Kayitlar kacar kacar okunur ve yazilir: butun koleksiyon bellege alinmaz.
 */

import { COUNTER_SEED_BATCH_SIZE } from '../config/constants.js';
import type { CounterSeedMode, StockCounterWriter, StockLevelSource } from '../domain/stock.js';

export interface SeedCountersDeps {
  readonly levels: StockLevelSource;
  readonly counters: StockCounterWriter;
  readonly batchSize?: number;
}

export interface SeedCountersResult {
  /** Mongo'da okunan stok kaydi. */
  readonly scanned: number;
  /** Redis'e fiilen yazilan sayac (missing'de var olanlar sayilmaz). */
  readonly written: number;
}

export type SeedCounters = (mode: CounterSeedMode) => Promise<SeedCountersResult>;

export function createSeedCounters(deps: SeedCountersDeps): SeedCounters {
  const batchSize = deps.batchSize ?? COUNTER_SEED_BATCH_SIZE;
  return async (mode) => {
    let scanned = 0;
    let written = 0;
    for await (const batch of deps.levels.batches(batchSize)) {
      scanned += batch.length;
      written += await deps.counters.write(batch, mode);
    }
    return { scanned, written };
  };
}
