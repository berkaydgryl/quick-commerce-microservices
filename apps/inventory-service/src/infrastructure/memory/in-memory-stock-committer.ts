/**
 * Bellekteki onay yazimi (MOCK=true, B16): eldeki adet bellekte (demo stogundan
 * baslar), defter bellekte. Ayni kurallar: kaydi zaten olan kalem atlanir,
 * eksiye dusmek reddedilmez. Tek senkron blok: arada baska cagri calisamaz.
 */

import type { CommitWriteResult, LedgerEntry, StockCommitter } from '../../domain/stock-ledger.js';
import type { StockLevel } from '../../domain/stock.js';
import { counterKey } from './in-memory-counter-key.js';
import type { InMemoryStockLedger } from './in-memory-stock-ledger.js';

export class InMemoryStockCommitter implements StockCommitter {
  private readonly onHand = new Map<string, number>();

  constructor(
    levels: readonly StockLevel[],
    private readonly ledger: InMemoryStockLedger,
  ) {
    for (const level of levels) {
      this.onHand.set(counterKey(level.marketId, level.sku), level.onHand);
    }
  }

  commit(entries: readonly LedgerEntry[]): Promise<CommitWriteResult> {
    let written = 0;
    const negative: { sku: string; onHand: number }[] = [];
    for (const entry of entries) {
      if (!this.ledger.insertIfAbsent(entry)) {
        continue;
      }
      const key = counterKey(entry.marketId, entry.sku);
      const onHand = (this.onHand.get(key) ?? 0) + entry.delta;
      this.onHand.set(key, onHand);
      written += 1;
      if (onHand < 0) {
        negative.push({ sku: entry.sku, onHand });
      }
    }
    return Promise.resolve({ written, negative });
  }

  /** Eldeki adet (testler icin). */
  onHandOf(marketId: string, sku: string): number | undefined {
    return this.onHand.get(counterKey(marketId, sku));
  }
}
