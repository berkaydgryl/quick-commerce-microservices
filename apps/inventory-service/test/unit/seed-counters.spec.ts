import { describe, expect, it } from 'vitest';

import { createSeedCounters } from '../../src/application/seed-counters.js';
import type { StockLevel, StockLevelSource } from '../../src/domain/stock.js';
import { InMemoryStockCounters } from '../../src/infrastructure/memory/in-memory-stock-counters.js';

const MARKET = 'mkt_migros-jet-moda';
const levels: readonly StockLevel[] = Array.from({ length: 7 }, (_, index) => ({
  marketId: MARKET,
  sku: `SKU-${index}`,
  onHand: index + 1,
}));

/** Verilen boyutta kaclar halinde veren kaynak; istenen boyutlari kaydeder. */
function sourceOf(all: readonly StockLevel[]) {
  const sizes: number[] = [];
  const source: StockLevelSource = {
    async *batches(batchSize) {
      await Promise.resolve();
      for (let start = 0; start < all.length; start += batchSize) {
        const batch = all.slice(start, start + batchSize);
        sizes.push(batch.length);
        yield batch;
      }
    },
  };
  return { source, sizes };
}

describe('sayac seed i (T9.2)', () => {
  it('kalici stogu kacar kacar okur ve hepsini yazar', async () => {
    const { source, sizes } = sourceOf(levels);
    const counters = new InMemoryStockCounters();

    const result = await createSeedCounters({ levels: source, counters, batchSize: 3 })(
      'overwrite',
    );

    expect(sizes).toEqual([3, 3, 1]);
    expect(result).toEqual({ scanned: 7, written: 7 });
    expect((await counters.available(MARKET, ['SKU-6'])).get('SKU-6')).toBe(7);
  });

  it('missing: var olan sayac sayilmaz ve ezilmez', async () => {
    const { source } = sourceOf(levels);
    const counters = new InMemoryStockCounters([{ marketId: MARKET, sku: 'SKU-0', onHand: 99 }]);

    const result = await createSeedCounters({ levels: source, counters })('missing');

    expect(result).toEqual({ scanned: 7, written: 6 });
    expect((await counters.available(MARKET, ['SKU-0'])).get('SKU-0')).toBe(99);
  });
});
