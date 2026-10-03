/**
 * Genel arama use-case'i (T9.6): bellek okuyuculariyla, demo verisi ve 3 demo
 * adresi uzerinde. Ayni sonuclarin gercek Mongo'da da ciktigi
 * test/integration/mongo-catalog.spec.ts icinde karsilastirilir.
 */

import { describe, expect, it, vi } from 'vitest';

import { createSearchNearby } from '../../src/application/search-nearby.js';
import { MAX_SEARCH_OFFERS_PER_MARKET } from '../../src/config/constants.js';
import type { NearbySearchResult } from '../../src/domain/nearby-search.js';
import type { MarketOfferMatches } from '../../src/domain/offer-reader.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import type { DemoAddressTitle } from '../support/demo-addresses.js';
import { demoLocation, EXPECTED_NEARBY } from '../support/demo-addresses.js';

const A101_CAFERAGA = 'mkt_a101-caferaga';
const MIGROS_MODA = 'mkt_migros-jet-moda';
const SOK_MODA = 'mkt_sok-moda';

const readers = createInMemoryReaders();
const searchNearby = createSearchNearby(readers);

const summary = (result: NearbySearchResult) => ({
  marketId: result.market.market.id,
  isOpen: result.market.market.isOpen,
  nameMatched: result.marketNameMatched,
  skus: result.offers.map((offer) => offer.product.sku),
  total: result.totalOfferMatches,
});

async function search(title: DemoAddressTitle, query: string) {
  return (await searchNearby({ location: demoLocation(title), query })).map(summary);
}

describe('searchNearby', () => {
  it('Ev "süt": urunu olan marketler yakindan uzaga; sut satmayan manav ve dukkanlar yok', async () => {
    expect(await search('Ev', 'süt')).toEqual([
      {
        marketId: A101_CAFERAGA,
        isOpen: true,
        nameMatched: false,
        skus: ['CIKOLATA-80', 'SUT-1L'],
        total: 2,
      },
      {
        marketId: MIGROS_MODA,
        isOpen: true,
        nameMatched: false,
        skus: ['CIKOLATA-80', 'SUT-1L'],
        total: 2,
      },
      { marketId: SOK_MODA, isOpen: true, nameMatched: false, skus: ['SUT-1L'], total: 1 },
    ]);
  });

  it('mesafe ListNearbyMarkets ile ayni (yuvarlanmamis metre)', async () => {
    const results = await searchNearby({ location: demoLocation('Ev'), query: 'süt' });
    const expected = new Map<string, number>(
      EXPECTED_NEARBY.Ev.map((entry) => [entry.marketId, entry.meters]),
    );

    for (const result of results) {
      expect(result.market.distanceMeters).toBeCloseTo(
        expected.get(result.market.market.id) ?? Number.NaN,
        0,
      );
    }
  });

  it('Ev "su": market basina ilk 3 teklif market sayfasi sirasinda, toplam 4 ("+1 urun daha")', async () => {
    expect(await search('Ev', 'su')).toEqual([
      {
        marketId: A101_CAFERAGA,
        isOpen: true,
        nameMatched: false,
        skus: ['CAMASIR-SUYU', 'CIKOLATA-80', 'SU-5L'],
        total: 4,
      },
      {
        marketId: MIGROS_MODA,
        isOpen: true,
        nameMatched: false,
        skus: ['CIKOLATA-80', 'PORTAKAL-SUYU-1L', 'SU-5L'],
        total: 4,
      },
      // T11.11: SOK su ve sut; kasap ile sarkuteri "sucuk".
      { marketId: SOK_MODA, isOpen: true, nameMatched: false, skus: ['SU-5L', 'SUT-1L'], total: 2 },
      {
        marketId: 'mkt_moda-kasabi',
        isOpen: true,
        nameMatched: false,
        skus: ['SUCUK-250'],
        total: 1,
      },
      {
        marketId: 'mkt_moda-sarkuteri',
        isOpen: true,
        nameMatched: false,
        skus: ['SUCUK-250'],
        total: 1,
      },
    ]);
  });

  it('PASIF teklif genel aramada yok: Ev "camasir" yalnizca A101 (Migros Moda satistan kaldirmis)', async () => {
    expect(await search('Ev', 'camasir')).toEqual([
      {
        marketId: A101_CAFERAGA,
        isOpen: true,
        nameMatched: false,
        skus: ['CAMASIR-SUYU'],
        total: 1,
      },
    ]);
  });

  it('market adi eslesmesi urunsuz da listelenir: Ev "migros"', async () => {
    expect(await search('Ev', 'migros')).toEqual([
      { marketId: MIGROS_MODA, isOpen: true, nameMatched: true, skus: [], total: 0 },
    ]);
  });

  it('Is "cips": acik marketler yakindan uzaga, KAPALI A101 Abbasaga en sonda', async () => {
    const results = await search('İş', 'cips');

    expect(results.map((result) => [result.marketId, result.isOpen])).toEqual([
      ['mkt_migros-jet-besiktas', true],
      ['mkt_carrefour-express-barbaros', true],
      ['mkt_a101-abbasaga', false],
    ]);
    expect(results.every((result) => result.skus.join() === 'CIPS-150')).toBe(true);
  });

  it('kapali market adiyla da bulunur: Is "a101"', async () => {
    expect(await search('İş', 'a101')).toEqual([
      { marketId: 'mkt_a101-abbasaga', isOpen: false, nameMatched: true, skus: [], total: 0 },
    ]);
  });

  it('eslesme yoksa bos liste, hata degil', async () => {
    expect(await search('Ev', 'xyzq')).toEqual([]);
  });

  it('Yazlik: kapsayan market yok -> bos; teklif sorgusu hic gitmez', async () => {
    const searchActiveOffers = vi.fn((): Promise<readonly MarketOfferMatches[]> =>
      Promise.resolve([]),
    );
    const stubbed = createSearchNearby({
      markets: readers.markets,
      offers: { searchActiveOffers },
    });

    expect(await stubbed({ location: demoLocation('Yazlık'), query: 'süt' })).toEqual([]);
    expect(searchActiveOffers).not.toHaveBeenCalled();
  });

  it('TEK teklif sorgusu, market sayisindan bagimsiz (N+1 yok): kapsayan marketlerin hepsi birden', async () => {
    const searchActiveOffers = vi.fn((): Promise<readonly MarketOfferMatches[]> =>
      Promise.resolve([]),
    );
    const stubbed = createSearchNearby({
      markets: readers.markets,
      offers: { searchActiveOffers },
    });

    await stubbed({ location: demoLocation('Ev'), query: 'süt' });

    expect(searchActiveOffers).toHaveBeenCalledOnce();
    expect(searchActiveOffers).toHaveBeenCalledWith(
      EXPECTED_NEARBY.Ev.map((entry) => entry.marketId),
      'süt',
      MAX_SEARCH_OFFERS_PER_MARKET,
    );
  });
});
