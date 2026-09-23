/**
 * Katalogun Mongo repository'leri: kurulum ve indeksler (ADR-15).
 *
 * Okuyan repository'ler KENDI portunu uygular (CategoryReader, MarketReader,
 * OfferReader). ProductRepository bugun yalnizca seed icindir. Seed yazimi ayri
 * sinifta: mongo-catalog-seeder.ts.
 */

import type { Db } from 'mongodb';

import { CategoryRepository } from './category-repository.js';
import { MarketRepository } from './market-repository.js';
import { OfferRepository } from './offer-repository.js';
import { ProductRepository } from './product-repository.js';

export interface MongoCatalogRepositories {
  readonly categories: CategoryRepository;
  readonly products: ProductRepository;
  readonly markets: MarketRepository;
  readonly offers: OfferRepository;
}

export function createMongoCatalogRepositories(db: Db): MongoCatalogRepositories {
  return {
    categories: new CategoryRepository(db),
    products: new ProductRepository(db),
    markets: new MarketRepository(db),
    offers: new OfferRepository(db),
  };
}

/**
 * Indeksleri olusturur. Acilista ve seed'den ONCE cagrilir: indeks
 * transaction icinde olusturulamaz ve benzersizlik kurali ilk yazimdan
 * itibaren gecerli olmali.
 */
export async function ensureCatalogIndexes(repositories: MongoCatalogRepositories): Promise<void> {
  await Promise.all([
    repositories.categories.ensureIndexes(),
    repositories.products.ensureIndexes(),
    repositories.markets.ensureIndexes(),
    repositories.offers.ensureIndexes(),
  ]);
}
