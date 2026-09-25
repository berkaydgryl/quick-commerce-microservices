/**
 * Teklif okuyucunun BELLEK uygulamasi. Mongo'daki karsiliklari birebir:
 *   - market + kategori  -> { marketId, categoryId }
 *   - metin aramasi      -> searchTerms uzerinde regex (searchKey ile normalize)
 *   - imlecli sayfalama  -> { _id: { $gt: token } } + sort({ _id: 1 }) + limit
 */

import type { Offer } from '../../domain/catalog.js';
import { matchesQuery, sortOffers } from '../../domain/catalog.js';
import type { OfferFilter, OfferPage, OfferReader, PageQuery } from '../../domain/offer-reader.js';
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
