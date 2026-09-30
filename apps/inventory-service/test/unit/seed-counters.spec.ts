import { describe, expect, it } from 'vitest';

import { createSeedCounters } from '../../src/application/seed-counters.js';
import type { CounterSetMarker, StockLevel, StockLevelSource } from '../../src/domain/stock.js';
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

/** Isaretin ne zaman konduğunu kaydeder. */
function markerSpy(events: string[] = []) {
  const marker: CounterSetMarker = {
    isPresent: () => Promise.resolve(events.includes('isaret')),
    markPresent: () => {
      events.push('isaret');
      return Promise.resolve();
    },
  };
  return { marker, events };
}

describe('sayac seed i (T9.2)', () => {
  it('kalici stogu kacar kacar okur ve hepsini yazar', async () => {
    const { source, sizes } = sourceOf(levels);
    const counters = new InMemoryStockCounters();

    const result = await createSeedCounters({
      levels: source,
      counters,
      marker: markerSpy().marker,
      batchSize: 3,
    })('overwrite');

    expect(sizes).toEqual([3, 3, 1]);
    expect(result).toEqual({ scanned: 7, written: 7 });
    expect((await counters.available(MARKET, ['SKU-6'])).get('SKU-6')).toBe(7);
  });

  it('missing: var olan sayac sayilmaz ve ezilmez', async () => {
    const { source } = sourceOf(levels);
    const counters = new InMemoryStockCounters([{ marketId: MARKET, sku: 'SKU-0', onHand: 99 }]);

    const result = await createSeedCounters({
      levels: source,
      counters,
      marker: markerSpy().marker,
    })('missing');

    expect(result).toEqual({ scanned: 7, written: 6 });
    expect((await counters.available(MARKET, ['SKU-0'])).get('SKU-0')).toBe(99);
  });
});

describe('sayac kumesinin isareti (T10.1 PR 2, ADR-17)', () => {
  it('isaret butun sayaclar yazildiktan SONRA konur', async () => {
    const { source } = sourceOf(levels);
    const events: string[] = [];
    const counters = new InMemoryStockCounters();
    const recording = {
      write: async (batch: readonly StockLevel[], mode: 'missing' | 'overwrite') => {
        events.push(`sayac:${batch.length}`);
        return counters.write(batch, mode);
      },
    };

    await createSeedCounters({
      levels: source,
      counters: recording,
      marker: markerSpy(events).marker,
      batchSize: 3,
    })('missing');

    expect(events).toEqual(['sayac:3', 'sayac:3', 'sayac:1', 'isaret']);
  });

  it('yazim yarida duserse isaret KONMAZ: kume bir sonraki eksik sayacta yeniden kurulur', async () => {
    const { source } = sourceOf(levels);
    const { marker, events } = markerSpy();
    const failing = { write: () => Promise.reject(new Error('redis koptu')) };

    await expect(
      createSeedCounters({ levels: source, counters: failing, marker })('missing'),
    ).rejects.toThrow('redis koptu');
    expect(events).toEqual([]);
  });
});
