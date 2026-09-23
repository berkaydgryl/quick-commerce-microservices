/**
 * Katalogun Mongo repository'leri: kurulum ve indeksler.
 *
 * Her repository KENDI portunu uygular (CategoryReader, ProductReader,
 * DarkStoreReader). Onceki surumde bu dosyadaki MongoCatalog sinifi uc
 * repository'yi tek arayuzde topluyor VE seed'i yaziyordu; okuma ve yazma
 * ayri sebeplerle degistigi icin bolundu (seed: mongo-catalog-seeder.ts).
 */

import type { Db } from 'mongodb';

import { CategoryRepository } from './category-repository.js';
import { DarkStoreRepository } from './dark-store-repository.js';
import { ProductRepository } from './product-repository.js';

export interface MongoCatalogRepositories {
  readonly categories: CategoryRepository;
  readonly products: ProductRepository;
  readonly darkStores: DarkStoreRepository;
}

export function createMongoCatalogRepositories(db: Db): MongoCatalogRepositories {
  return {
    categories: new CategoryRepository(db),
    products: new ProductRepository(db),
    darkStores: new DarkStoreRepository(db),
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
    repositories.darkStores.ensureIndexes(),
  ]);
}
