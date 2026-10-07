/**
 * BatchGetMarkets use-case (T11.13): favori isletmeler sayfasinin toplu
 * market okumasi. gRPC ucu test/unit/grpc/batch-get-markets.spec.ts'te.
 */

import { describe, expect, it, vi } from 'vitest';

import { createBatchGetMarkets } from '../../src/application/batch-get-markets.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import { CLASSIC_SNAPSHOT } from '../support/classic-catalog.js';

const { markets: MARKETS } = CLASSIC_SNAPSHOT;

const { markets } = createInMemoryReaders(CLASSIC_SNAPSHOT);
const batchGetMarkets = createBatchGetMarkets({ markets });

describe('batchGetMarkets', () => {
  it('istek sirasini korur; olmayan kimlik missing de, istek sirasinda', async () => {
    const result = await batchGetMarkets([
      'mkt_moda-kasabi',
      'mkt_yok-1',
      'mkt_migros-jet-moda',
      'mkt_yok-2',
    ]);

    expect(result.markets.map((market) => market.id)).toEqual([
      'mkt_moda-kasabi',
      'mkt_migros-jet-moda',
    ]);
    expect(result.missing).toEqual(['mkt_yok-1', 'mkt_yok-2']);
  });

  it('kapali market de doner (acik/kapali kartin bilgisi)', async () => {
    const { markets: found } = await batchGetMarkets(['mkt_a101-abbasaga']);

    expect(found.map((market) => [market.id, market.isOpen])).toEqual([
      ['mkt_a101-abbasaga', false],
    ]);
  });

  it('tekrarlanan kimlik tek sayilir', async () => {
    const result = await batchGetMarkets(['mkt_sok-moda', 'mkt_sok-moda', 'mkt_yok', 'mkt_yok']);

    expect(result.markets).toHaveLength(1);
    expect(result.missing).toEqual(['mkt_yok']);
  });

  it('TEK okuma, kimlik sayisindan bagimsiz (N+1 yok)', async () => {
    const findMarketsByIds = vi.fn(() => Promise.resolve(MARKETS));
    const stubbed = createBatchGetMarkets({ markets: { findMarketsByIds } });

    await stubbed(MARKETS.map((market) => market.id));

    expect(findMarketsByIds).toHaveBeenCalledOnce();
  });

  it('bos liste bos cevap', async () => {
    expect(await batchGetMarkets([])).toEqual({ markets: [], missing: [] });
  });
});
