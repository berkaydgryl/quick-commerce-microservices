/**
 * Bellekteki sayaclar (MOCK=true): Mongo ve Redis olmadan ayni sozlesme.
 * Testler de ayni sinifi kullanir; Redis uygulamasi ayni senaryolardan gecer
 * (test/support/stock-counter-contract.ts). Rezervasyon deposu ayni haritayi
 * paylasir (in-memory-stock.ts).
 */

import type {
  CounterSeedMode,
  StockCounterReader,
  StockCounterWriter,
  StockLevel,
} from '../../domain/stock.js';

import { counterKey } from './in-memory-counter-key.js';

export class InMemoryStockCounters implements StockCounterReader, StockCounterWriter {
  /** @param counters Paylasilan harita (rezervasyon deposu da buna yazar). */
  constructor(
    levels: readonly StockLevel[] = [],
    private readonly counters = new Map<string, number>(),
  ) {
    for (const level of levels) {
      this.counters.set(counterKey(level.marketId, level.sku), level.onHand);
    }
  }

  available(marketId: string, skus: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const found = new Map<string, number>();
    for (const sku of skus) {
      const count = this.counters.get(counterKey(marketId, sku));
      if (count !== undefined) {
        found.set(sku, count);
      }
    }
    return Promise.resolve(found);
  }

  write(levels: readonly StockLevel[], mode: CounterSeedMode): Promise<number> {
    let written = 0;
    for (const level of levels) {
      const key = counterKey(level.marketId, level.sku);
      if (mode === 'missing' && this.counters.has(key)) {
        continue;
      }
      this.counters.set(key, level.onHand);
      written += 1;
    }
    return Promise.resolve(written);
  }
}
