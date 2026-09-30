import { describe, expect, it, vi } from 'vitest';

import { createCheckAvailability } from '../../src/application/check-availability.js';
import type { StockCounterReader } from '../../src/domain/stock.js';
import { InMemoryStockCounters } from '../../src/infrastructure/memory/in-memory-stock-counters.js';

const MARKET = 'mkt_migros-jet-moda';
const counters = new InMemoryStockCounters([
  { marketId: MARKET, sku: 'SUT-1L', onHand: 24 },
  { marketId: MARKET, sku: 'KOLA-1L', onHand: 0 },
]);

/** Redis bosalmamis: bulunamayan sayac gercekten yoktur. */
const noRecovery = () => Promise.resolve(false);

describe('CheckAvailability (T9.1)', () => {
  it('sayaci olan adediyle, olmayan unknownSkus ile; ikisi de istek sirasinda', async () => {
    const check = createCheckAvailability({ counters, recoverCounters: noRecovery });

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
    const result = await createCheckAvailability({ counters, recoverCounters: noRecovery })({
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

    const result = await createCheckAvailability({
      counters: { available },
      recoverCounters: noRecovery,
    })({
      marketId: MARKET,
      skus: ['sut 1l', 'SUT-1L'],
    });

    expect(available).toHaveBeenCalledWith(MARKET, ['SUT-1L']);
    expect(result.unknownSkus).toEqual(['sut 1l']);
  });

  it('bos liste depoya gitmez, bos cevap', async () => {
    const available = vi.fn<StockCounterReader['available']>();

    const result = await createCheckAvailability({
      counters: { available },
      recoverCounters: noRecovery,
    })({
      marketId: MARKET,
      skus: [],
    });

    expect(available).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], unknownSkus: [] });
  });

  it('bilinmeyen market hata degil: SKU lar unknownSkus ta', async () => {
    const result = await createCheckAvailability({ counters, recoverCounters: noRecovery })({
      marketId: 'mkt_yok',
      skus: ['SUT-1L'],
    });

    expect(result).toEqual({ items: [], unknownSkus: ['SUT-1L'] });
  });
});

describe('CheckAvailability: Redis bosalinca (T10.1 PR 2, ADR-17)', () => {
  it('bulunamayan sayac yoksa kurtarma HIC sorulmaz (normal istekte ek maliyet yok)', async () => {
    const recoverCounters = vi.fn(() => Promise.resolve(false));

    await createCheckAvailability({ counters, recoverCounters })({
      marketId: MARKET,
      skus: ['SUT-1L'],
    });

    expect(recoverCounters).not.toHaveBeenCalled();
  });

  it('sayaclar yeniden kurulduysa okuma BIR KEZ tekrarlanir; adetler doner', async () => {
    const available = vi
      .fn<StockCounterReader['available']>()
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([['SUT-1L', 24]]));
    const recoverCounters = vi.fn(() => Promise.resolve(true));

    const result = await createCheckAvailability({ counters: { available }, recoverCounters })({
      marketId: MARKET,
      skus: ['SUT-1L'],
    });

    expect(recoverCounters).toHaveBeenCalledOnce();
    expect(available).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ items: [{ sku: 'SUT-1L', availableQuantity: 24 }], unknownSkus: [] });
  });

  it('Redis bosalmamissa (kurtarma false) okuma tekrarlanmaz; SKU bilinmiyor', async () => {
    const available = vi.fn<StockCounterReader['available']>(() => Promise.resolve(new Map()));
    const recoverCounters = vi.fn(() => Promise.resolve(false));

    const result = await createCheckAvailability({ counters: { available }, recoverCounters })({
      marketId: MARKET,
      skus: ['YOK-1'],
    });

    expect(available).toHaveBeenCalledOnce();
    expect(result.unknownSkus).toEqual(['YOK-1']);
  });

  it('bicimi bozuk SKU kurtarma tetiklemez (zaten okunmaz)', async () => {
    const recoverCounters = vi.fn(() => Promise.resolve(true));

    await createCheckAvailability({ counters, recoverCounters })({
      marketId: MARKET,
      skus: ['sut 1l', 'SUT-1L'],
    });

    expect(recoverCounters).not.toHaveBeenCalled();
  });
});
