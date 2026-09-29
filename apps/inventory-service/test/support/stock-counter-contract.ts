/**
 * Sayac sozlesmesi: bellek (MOCK) ve Redis uygulamalari AYNI senaryolardan
 * gecer. Bellekteki uygulama birim testinde, Redis entegrasyon testinde kosar.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { StockCounterReader, StockCounterWriter, StockLevel } from '../../src/domain/stock.js';

export type Counters = StockCounterReader & StockCounterWriter;

const MARKET = 'mkt_migros-jet-moda';
const OTHER_MARKET = 'mkt_a101-caferaga';

const LEVELS: readonly StockLevel[] = [
  { marketId: MARKET, sku: 'SUT-1L', onHand: 24 },
  { marketId: MARKET, sku: 'KOLA-1L', onHand: 0 },
  { marketId: OTHER_MARKET, sku: 'SUT-1L', onHand: 2 },
];

/** fresh: her testten once BOS sayaclar (Redis'te FLUSHALL). */
export function describeStockCounterContract(name: string, fresh: () => Promise<Counters>): void {
  describe(`sayac sozlesmesi (${name})`, () => {
    let counters: Counters;

    beforeEach(async () => {
      counters = await fresh();
      await counters.write(LEVELS, 'overwrite');
    });

    it('sayaci olan SKU adediyle doner; 0 da bir adettir (tukendi)', async () => {
      const found = await counters.available(MARKET, ['SUT-1L', 'KOLA-1L']);

      expect([...found]).toEqual([
        ['SUT-1L', 24],
        ['KOLA-1L', 0],
      ]);
    });

    it('sayaci olmayan SKU haritada yoktur (bu markette satilmiyor)', async () => {
      const found = await counters.available(MARKET, ['SUT-1L', 'YOK-1']);

      expect(found.has('YOK-1')).toBe(false);
      expect(found.get('SUT-1L')).toBe(24);
    });

    it('sayaclar market basinadir', async () => {
      expect((await counters.available(OTHER_MARKET, ['SUT-1L'])).get('SUT-1L')).toBe(2);
      expect((await counters.available('mkt_yok', ['SUT-1L'])).size).toBe(0);
    });

    it('bos liste bos cevap', async () => {
      expect((await counters.available(MARKET, [])).size).toBe(0);
    });

    it('missing: var olan sayaca DOKUNMAZ, yalnizca olmayani yazar', async () => {
      const written = await counters.write(
        [
          { marketId: MARKET, sku: 'SUT-1L', onHand: 99 },
          { marketId: MARKET, sku: 'MUZ-1K', onHand: 7 },
        ],
        'missing',
      );

      expect(written).toBe(1);
      const found = await counters.available(MARKET, ['SUT-1L', 'MUZ-1K']);
      expect(found.get('SUT-1L')).toBe(24);
      expect(found.get('MUZ-1K')).toBe(7);
    });

    it('overwrite: hepsini bastan yazar', async () => {
      const written = await counters.write(
        [{ marketId: MARKET, sku: 'SUT-1L', onHand: 99 }],
        'overwrite',
      );

      expect(written).toBe(1);
      expect((await counters.available(MARKET, ['SUT-1L'])).get('SUT-1L')).toBe(99);
    });
  });
}
