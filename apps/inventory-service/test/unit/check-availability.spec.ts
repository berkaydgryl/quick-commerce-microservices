import { describe, expect, it, vi } from 'vitest';

import { createCheckAvailability } from '../../src/application/check-availability.js';
import type { StockCounterReader } from '../../src/domain/stock.js';
import { InMemoryStockCounters } from '../../src/infrastructure/memory/in-memory-stock-counters.js';

const MARKET = 'mkt_migros-jet-moda';
const counters = new InMemoryStockCounters([
  { marketId: MARKET, sku: 'SUT-1L', onHand: 24 },
  { marketId: MARKET, sku: 'KOLA-1L', onHand: 0 },
]);

describe('CheckAvailability (T9.1)', () => {
  it('sayaci olan adediyle, olmayan unknownSkus ile; ikisi de istek sirasinda', async () => {
    const check = createCheckAvailability({ counters });

    const result = await check({ marketId: MARKET, skus: ['YOK-1', 'KOLA-1L', 'SUT-1L'] });

    expect(result).toEqual({
      items: [
        { sku: 'KOLA-1L', availableQuantity: 0 },
        { sku: 'SUT-1L', availableQuantity: 24 },
      ],
      unknownSkus: ['YOK-1'],
    });
  });

  it('tekrarlanan SKU tek sayilir', async () => {
    const result = await createCheckAvailability({ counters })({
      marketId: MARKET,
      skus: ['SUT-1L', 'SUT-1L', 'YOK-1', 'YOK-1'],
    });

    expect(result).toEqual({
      items: [{ sku: 'SUT-1L', availableQuantity: 24 }],
      unknownSkus: ['YOK-1'],
    });
  });

  it('bicimi bozuk SKU okunmaz, unknownSkus a duser (liste dusmez)', async () => {
    const available = vi.fn<StockCounterReader['available']>(() =>
      Promise.resolve(new Map([['SUT-1L', 24]])),
    );

    const result = await createCheckAvailability({ counters: { available } })({
      marketId: MARKET,
      skus: ['sut 1l', 'SUT-1L'],
    });

    expect(available).toHaveBeenCalledWith(MARKET, ['SUT-1L']);
    expect(result.unknownSkus).toEqual(['sut 1l']);
  });

  it('bos liste depoya gitmez, bos cevap', async () => {
    const available = vi.fn<StockCounterReader['available']>();

    const result = await createCheckAvailability({ counters: { available } })({
      marketId: MARKET,
      skus: [],
    });

    expect(available).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], unknownSkus: [] });
  });

  it('bilinmeyen market hata degil: SKU lar unknownSkus ta', async () => {
    const result = await createCheckAvailability({ counters })({
      marketId: 'mkt_yok',
      skus: ['SUT-1L'],
    });

    expect(result).toEqual({ items: [], unknownSkus: ['SUT-1L'] });
  });
});
