/**
 * Katalog deposunun BELLEK uygulamasi - MOCK=true modu (ADR-09).
 *
 * Mongo uygulamasi (infrastructure/mongo) ayni arayuzu saglar ve AYNI sozlesme
 * testinden gecer (test/support/catalog-repository-contract.ts); boylece MOCK
 * modu ile gercek mod ayni sorguya ayni cevabi verir. Buradaki filtreleme ve
 * sayfalama, Mongo'daki karsiliklariyla birebir:
 *   - esitlik filtresi   -> { categoryId }
 *   - depo cesidi        -> { darkStoreIds: id }
 *   - metin aramasi      -> searchTerms uzerinde regex (searchKey ile normalize)
 *   - imlecli sayfalama  -> { _id: { $gt: token } } + sort({ _id: 1 }) + limit
 */

import type {
  CatalogRepository,
  PageQuery,
  ProductFilter,
  ProductPage,
} from '../domain/catalog-repository.js';
import type { Category, Product } from '../domain/catalog.js';
import { matchesQuery, sortProducts } from '../domain/catalog.js';
import type { CatalogSnapshot } from '../domain/catalog-snapshot.js';
import { sliceByCursor } from '../domain/pagination.js';
import { CATALOG_SNAPSHOT } from './fixtures.js';

export class InMemoryCatalogRepository implements CatalogRepository {
  private readonly snapshot: CatalogSnapshot;
  /** Sayfalama imleci sirali liste ister; bir kez siralanir. */
  private readonly sortedProducts: readonly Product[];
  private readonly darkStoreIds: ReadonlySet<string>;

  constructor(snapshot: CatalogSnapshot = CATALOG_SNAPSHOT) {
    this.snapshot = snapshot;
    this.sortedProducts = sortProducts(snapshot.products);
    this.darkStoreIds = new Set(snapshot.darkStores.map((store) => store.id));
  }

  listCategories(): Promise<readonly Category[]> {
    return Promise.resolve(this.snapshot.categories);
  }

  listProducts(filter: ProductFilter, page: PageQuery): Promise<ProductPage> {
    const matched = this.sortedProducts.filter((product) => this.matches(product, filter));
    const slice = sliceByCursor(matched, page.size, page.token);

    return Promise.resolve({ ...slice, totalSize: matched.length });
  }

  darkStoreExists(darkStoreId: string): Promise<boolean> {
    return Promise.resolve(this.darkStoreIds.has(darkStoreId));
  }

  private matches(product: Product, filter: ProductFilter): boolean {
    if (filter.categoryId !== undefined && product.categoryId !== filter.categoryId) {
      return false;
    }
    if (filter.darkStoreId !== undefined) {
      const stocked = this.snapshot.assortment[filter.darkStoreId] ?? [];
      if (!stocked.includes(product.id)) {
        return false;
      }
    }
    if (filter.query !== undefined && !matchesQuery(product, filter.query)) {
      return false;
    }
    return true;
  }
}
