/**
 * Genel arama kurali (T9.6, saf): hangi market listelenir, hangi sirada.
 *
 * Siralama SENTETIK marketlerle sinanir: demo verisinde kapali market zaten en
 * uzakta oldugu icin "kapali en sonda" kurali orada kendiliginden saglanir ve
 * kural bozulsa bile test yakalamaz.
 */

import { describe, expect, it } from 'vitest';

import type { Market, Offer } from '../../src/domain/catalog.js';
import type { MarketDistance } from '../../src/domain/market-coverage.js';
import { buildNearbySearchResults, marketNameMatches } from '../../src/domain/nearby-search.js';
import type { NearbySearchResult } from '../../src/domain/nearby-search.js';
import { MARKETS } from '../../src/infrastructure/fixtures.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';

function demoMarket(id: string): Market {
  const found = MARKETS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`demo verisinde market yok: ${id}`);
  return found;
}

function market(id: string, name: string, isOpen = true): Market {
  return { ...demoMarket('mkt_migros-jet-moda'), id, name, isOpen };
}

function at(target: Market, distanceMeters: number): MarketDistance {
  return { market: target, distanceMeters };
}

/** Gercek teklifler: kural onlari yalnizca tasir, icerigine bakmaz. */
async function someOffers(count: number): Promise<readonly Offer[]> {
  const { offers } = createInMemoryReaders();
  const page = await offers.listOffers(
    { marketId: 'mkt_migros-jet-moda' },
    { size: count, token: '' },
  );
  return page.items;
}

const summary = (result: NearbySearchResult) => ({
  marketId: result.market.market.id,
  nameMatched: result.marketNameMatched,
  total: result.totalOfferMatches,
});

describe('marketNameMatches', () => {
  const moda = demoMarket('mkt_migros-jet-moda'); // "Migros Jet – Moda"
  const abbasaga = demoMarket('mkt_a101-abbasaga'); // "A101 – Abbasağa"
  const manav = demoMarket('mkt_kardesler-manavi'); // "Kardeşler Manavı"

  it('buyuk/kucuk harf ve Turkce karakter duyarsiz (urun aramasiyla ayni kural)', () => {
    expect(marketNameMatches(moda, 'MİGROS')).toBe(true);
    expect(marketNameMatches(abbasaga, 'abbasaga')).toBe(true);
    expect(marketNameMatches(manav, 'KARDEŞLER MANAVI')).toBe(true);
    expect(marketNameMatches(manav, 'kardesler manavi')).toBe(true);
  });

  it('her kelime adda gecmeli, sira onemsiz; kelime icinde de eslesir', () => {
    expect(marketNameMatches(moda, 'moda migros')).toBe(true);
    expect(marketNameMatches(moda, 'migr')).toBe(true);
    expect(marketNameMatches(moda, 'migros besiktas')).toBe(false);
    expect(marketNameMatches(moda, 'carrefour')).toBe(false);
  });

  it('ad ve urun kelimeleri birlesmez: "migros süt" market adiyla eslesmez', () => {
    expect(marketNameMatches(moda, 'migros süt')).toBe(false);
  });

  it('kelimesiz sorgu hicbir marketle eslesmez', () => {
    expect(marketNameMatches(moda, '   ')).toBe(false);
  });
});

describe('buildNearbySearchResults', () => {
  // Kapali market EN YAKINDA: kural onu yine de sona koymali.
  const closedNear = at(market('mkt_kapali-yakin', 'Yakın Bakkal', false), 100);
  const nameOnly = at(market('mkt_sut-evi', 'Süt Evi'), 200);
  const noMatch = at(market('mkt_eslesmesiz', 'Boş Market'), 250);
  const openFar = at(market('mkt_acik-uzak', 'Uzak Market'), 300);
  const closedFar = at(market('mkt_kapali-uzak', 'Uzak Bakkal', false), 400);
  const markets = [closedNear, nameOnly, noMatch, openFar, closedFar];

  it('adi ya da urunu eslesen marketler: ACIK olanlar once, her grup yakindan uzaga', async () => {
    const [offer] = await someOffers(1);
    if (offer === undefined) throw new Error('demo verisinde teklif yok');

    const results = buildNearbySearchResults(
      markets,
      [
        { marketId: 'mkt_kapali-uzak', offers: [offer], totalMatches: 1 },
        { marketId: 'mkt_acik-uzak', offers: [offer], totalMatches: 7 },
        { marketId: 'mkt_kapali-yakin', offers: [offer], totalMatches: 2 },
      ],
      'süt',
    );

    expect(results.map(summary)).toEqual([
      { marketId: 'mkt_sut-evi', nameMatched: true, total: 0 },
      { marketId: 'mkt_acik-uzak', nameMatched: false, total: 7 },
      { marketId: 'mkt_kapali-yakin', nameMatched: false, total: 2 },
      { marketId: 'mkt_kapali-uzak', nameMatched: false, total: 1 },
    ]);
  });

  it('teklifler ve mesafe aynen tasinir; yalnizca ad eslesen marketin teklif listesi bos', async () => {
    const offers = await someOffers(3);

    const [nameMatch, offerMatch] = buildNearbySearchResults(
      markets,
      [{ marketId: 'mkt_acik-uzak', offers, totalMatches: 9 }],
      'süt',
    );

    expect(nameMatch?.offers).toEqual([]);
    expect(offerMatch?.market).toBe(openFar);
    expect(offerMatch?.offers).toBe(offers);
  });

  it('adi da urunu da eslesen market tek sonuc, iki bilgi birlikte', async () => {
    const offers = await someOffers(2);

    const results = buildNearbySearchResults(
      [nameOnly],
      [{ marketId: 'mkt_sut-evi', offers, totalMatches: 2 }],
      'süt',
    );

    expect(results.map(summary)).toEqual([
      { marketId: 'mkt_sut-evi', nameMatched: true, total: 2 },
    ]);
  });

  it('eslesmesi olmayan market listede yok; listede olmayan marketin eslesmesi yok sayilir', async () => {
    const offers = await someOffers(1);

    expect(
      buildNearbySearchResults(
        [noMatch],
        [{ marketId: 'mkt_baska', offers, totalMatches: 1 }],
        'süt',
      ),
    ).toEqual([]);
  });
});
