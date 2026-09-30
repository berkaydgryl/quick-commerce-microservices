/**
 * Teklif okuyucunun BELLEK uygulamasi. Mongo'daki karsiliklari birebir:
 *   - market + kategori  -> { marketId, categoryId }
 *   - metin aramasi      -> kelime basina searchTerms regex'i, $and (searchWords ile normalize)
 *   - imlecli sayfalama  -> { _id: { $gt: token } } + sort({ _id: 1 }) + limit
 *   - genel arama (T9.6) -> { marketId: $in, isActive } + kelimeler, _id sirasi,
 *                           market basina ilk N + toplam ($group, $firstN)
 */

import type { Offer } from '../../domain/catalog.js';
import { matchesQuery, searchWords, sortOffers } from '../../domain/catalog.js';
import type {
  MarketOfferMatches,
  OfferFilter,
  OfferPage,
  OfferReader,
  PageQuery,
} from '../../domain/offer-reader.js';
import { sliceByCursor } from '../../domain/pagination.js';

export class InMemoryOfferReader implements OfferReader {
  /** Sayfalama imleci sirali liste ister; bir kez siralanir. */
  private readonly sorted: readonly Offer[];

  constructor(offers: readonly Offer[]) {
    this.sorted = sortOffers(offers);
  }

  listOffers(filter: OfferFilter, page: PageQuery): Promise<OfferPage> {
    const matched = this.sorted.filter((offer) => matches(offer, filter));
    const slice = sliceByCursor(matched, page.size, page.token);
    return Promise.resolve({ ...slice, totalSize: matched.length });
  }

  listCategoryIdsWithOffers(marketId: string): Promise<readonly string[]> {
    const ids = new Set(
      this.sorted
        .filter((offer) => offer.marketId === marketId && offer.isActive)
        .map((offer) => offer.product.categoryId),
    );
    return Promise.resolve([...ids]);
  }

  findOffersByProductIds(
    marketId: string,
    productIds: readonly string[],
  ): Promise<readonly Offer[]> {
    const wanted = new Set(productIds);
    return Promise.resolve(
      this.sorted.filter((offer) => offer.marketId === marketId && wanted.has(offer.product.id)),
    );
  }

  searchActiveOffers(
    marketIds: readonly string[],
    query: string,
    perMarket: number,
  ): Promise<readonly MarketOfferMatches[]> {
    if (searchWords(query).length === 0) {
      return Promise.resolve([]);
    }
    const wanted = new Set(marketIds);
    const groups = new Map<string, Offer[]>();
    for (const offer of this.sorted) {
      if (wanted.has(offer.marketId) && offer.isActive && matchesQuery(offer.product, query)) {
        const group = groups.get(offer.marketId) ?? [];
        group.push(offer);
        groups.set(offer.marketId, group);
      }
    }
    return Promise.resolve(
      [...groups].map(([marketId, offers]) => ({
        marketId,
        offers: offers.slice(0, perMarket),
        totalMatches: offers.length,
      })),
    );
  }
}

function matches(offer: Offer, filter: OfferFilter): boolean {
  if (offer.marketId !== filter.marketId) {
    return false;
  }
  if (filter.categoryId !== undefined && offer.product.categoryId !== filter.categoryId) {
    return false;
  }
  return filter.query === undefined || matchesQuery(offer.product, filter.query);
}
