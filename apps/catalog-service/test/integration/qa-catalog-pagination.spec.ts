/**
 * QA kara kutu (T15.2, catalog geriye donuk PR 1; CQ4): ListProducts imleci GERCEK Mongo'da, iki
 * catalog kopyasi ayni veritabaninda; sayfalar kopyalardan donusumlu istenir (jeton kopyadan
 * bagimsiz olmali).
 *
 *   S1 kucuk sayfalarla (7) bastan sona: tekrar ve atlama yok; birlesim tek buyuk sayfayla ayni;
 *      filtresiz liste fixture'daki teklif kimlikleriyle birebir (market 89 teklif, biri pasif:
 *      market sayfasi pasifi de verir); aramali ve kategorili liste de ayni kuralla, hepsi cok sayfa.
 *   S2 sayfa boyutu (122 teklifli sentetik market, kirpma gorunur): 0 ve negatif varsayilana
 *      (PAGE_SIZE_DEFAULT), ust sinirin ustu PAGE_SIZE_MAX'a kirpilir ve jetonu kalani verir; son
 *      kaydin otesindeki jeton bos sayfa ve bos jeton.
 */

import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@getir/contracts';
import { catalogV1 } from '@getir/proto';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { describe, expect, it } from 'vitest';

import { offerIdFor } from '../../src/domain/catalog.js';
import type { CatalogSnapshot } from '../../src/domain/catalog-snapshot.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { syntheticMarket, useCatalogWorld } from '../support/qa-catalog-world.js';

const world = useCatalogWorld('qa_catalog_sayfa');
const MARKET = 'mkt_migros-jet-moda';
const SMALL_PAGE = 7;
/** Jetonla gezilen en cok sayfa: imlec donguye girerse zaman asimi yerine acik hata. */
const MAX_PAGES = 100;

interface ListFilter {
  readonly categoryId?: string;
  readonly query?: string;
}

async function page(
  server: TestGrpcServer | undefined,
  filter: ListFilter,
  pageSize: number,
  pageToken = '',
  marketId = MARKET,
) {
  if (server === undefined) throw new Error('catalog kopyasi yok');
  const { response, error } = await server.call(catalogV1.CatalogServiceService.listProducts, {
    ...catalogV1.ListProductsRequest.fromPartial({}),
    marketId,
    categoryId: filter.categoryId ?? '',
    query: filter.query ?? '',
    page: { pageSize, pageToken },
  });
  if (response === undefined) throw new Error(`liste okunamadi: ${error?.message ?? ''}`);
  return {
    ids: response.offers.map((offer) => offer.id),
    next: response.page?.nextPageToken ?? '',
  };
}

/** Bastan sona kucuk sayfalar, kopyalar donusumlu. */
async function walk(copies: readonly TestGrpcServer[], filter: ListFilter): Promise<string[]> {
  const ids: string[] = [];
  let token = '';
  for (let index = 0; index === 0 || token !== ''; index += 1) {
    if (index >= MAX_PAGES) throw new Error(`sayfalama ${String(MAX_PAGES)} sayfada bitmedi`);
    const current = await page(copies[index % copies.length], filter, SMALL_PAGE, token);
    ids.push(...current.ids);
    token = current.next;
  }
  return ids;
}

describe('QA CQ4 ListProducts imleci (iki kopya, gercek Mongo)', () => {
  it('S1 kucuk sayfalarla bastan sona tekrar ve atlama yok; tek buyuk sayfayla ve fixture ile ayni (filtreli de)', async () => {
    const copies = await world.open(CATALOG_SNAPSHOT, { copies: 2 });
    const category = CATALOG_SNAPSHOT.categories[0]?.id;
    const filters: ListFilter[] = [
      {},
      { query: 'ka' },
      ...(category === undefined ? [] : [{ categoryId: category }]),
    ];
    for (const filter of filters) {
      const label = JSON.stringify(filter);
      const all = await page(copies[0], filter, PAGE_SIZE_MAX);
      expect(all.next, label).toBe('');
      // Her suzgec gercekten birden cok sayfa: esitlik bos ya da tek sayfayla gecmesin.
      expect(all.ids.length, label).toBeGreaterThan(SMALL_PAGE);
      const walked = await walk(copies, filter);
      expect(walked, label).toEqual(all.ids);
      expect(new Set(walked).size, label).toBe(walked.length);
    }

    // Market sayfasi (ListProducts) pasif teklifleri de verir (isActive false: "satista degil",
    // kayit silinmez). Filtresiz liste bu marketin butun teklifleri, kimlik sirasinda.
    const own = CATALOG_SNAPSHOT.offers.filter((offer) => offer.marketId === MARKET);
    expect(
      own.some((offer) => !offer.isActive),
      'fixture: bu markette pasif teklif yok',
    ).toBe(true);
    const full = await page(copies[1], {}, PAGE_SIZE_MAX);
    expect(full.ids).toEqual(own.map((offer) => offerIdFor(MARKET, offer.productId)).sort());
  });

  it('S2 sayfa boyutu: 0 ve negatif varsayilan, ust sinirin ustu kirpilir ve jetonu kalani verir; son kaydin otesi bos', async () => {
    // Kirpma gorunsun diye PAGE_SIZE_MAX'tan COK teklifli market: butun urunler satista.
    const big = syntheticMarket('sayfa', { lat: 41.2, lng: 29.3 }, 1_000);
    const bigOffers = CATALOG_SNAPSHOT.products.map((product) => ({
      marketId: big.id,
      productId: product.id,
      priceMinor: 1_000,
      isActive: true,
    }));
    expect(bigOffers.length).toBeGreaterThan(PAGE_SIZE_MAX);
    const snapshot: CatalogSnapshot = {
      ...CATALOG_SNAPSHOT,
      markets: [...CATALOG_SNAPSHOT.markets, big],
      offers: [...CATALOG_SNAPSHOT.offers, ...bigOffers],
    };
    const [server] = await world.open(snapshot);
    const at = (size: number, token = '') => page(server, {}, size, token, big.id);
    const sorted = bigOffers.map((offer) => offerIdFor(big.id, offer.productId)).sort();

    for (const size of [0, -1]) {
      expect((await at(size)).ids, String(size)).toEqual(sorted.slice(0, PAGE_SIZE_DEFAULT));
    }
    const clipped = await at(PAGE_SIZE_MAX + 1);
    expect(clipped.ids).toEqual(sorted.slice(0, PAGE_SIZE_MAX));
    const rest = await at(PAGE_SIZE_MAX, clipped.next);
    expect([rest.ids, rest.next]).toEqual([sorted.slice(PAGE_SIZE_MAX), '']);

    const last = sorted.at(-1) ?? '';
    expect(await at(SMALL_PAGE, `${last}~`)).toEqual({ ids: [], next: '' });
  });
});
