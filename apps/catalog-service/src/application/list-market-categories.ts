/**
 * Use-case: marketin en az bir aktif teklifi olan kategoriler (ADR-15).
 * Manav yalnizca meyve-sebzeyi gosterir; bos kategori vitrine cikmaz.
 */

import { AppError } from '@getir/core';

import type { Category } from '../domain/catalog.js';
import { sortCategories } from '../domain/catalog.js';
import type { CategoryReader } from '../domain/category-reader.js';
import type { MarketReader } from '../domain/market-reader.js';
import type { OfferReader } from '../domain/offer-reader.js';

export interface ListMarketCategoriesDeps {
  readonly categories: CategoryReader;
  readonly markets: MarketReader;
  readonly offers: OfferReader;
}

export type ListMarketCategories = (marketId: string) => Promise<readonly Category[]>;

export function createListMarketCategories(deps: ListMarketCategoriesDeps): ListMarketCategories {
  return async (marketId) => {
    // "Market yok" ile "marketin teklifi yok" ayri ekranlardir: ilki NOT_FOUND.
    if (!(await deps.markets.marketExists(marketId))) {
      throw AppError.notFound('Market bulunamadi', { details: { marketId } });
    }

    const [categories, withOffers] = await Promise.all([
      deps.categories.listCategories(),
      deps.offers.listCategoryIdsWithOffers(marketId),
    ]);
    const present = new Set(withOffers);
    return sortCategories(categories.filter((category) => present.has(category.id)));
  };
}
