/**
 * Katalog deposunun BELLEK uygulamasi (T3.1).
 *
 * Mongo uygulamasi T4.1'de gelecek ve ayni arayuzu (CatalogRepository)
 * saglayacak; use-case'ler degismeyecek. Buradaki filtreleme ve sayfalama
 * mantigi bilincli olarak Mongo'da karsiligi olan islemlerden secildi:
 *   - esitlik filtresi   -> { categoryId }
 *   - metin aramasi      -> $text / regex
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
import { sliceByCursor } from '../domain/pagination.js';
import { CATEGORIES, DARK_STORES, PRODUCTS, STORE_ASSORTMENT } from './fixtures.js';

export interface InMemoryCatalogData {
  readonly categories: readonly Category[];
  readonly products: readonly Product[];
  readonly darkStoreIds: readonly string[];
  /** depo -> satilan urun kimlikleri */
  readonly assortment: Readonly<Record<string, readonly string[]>>;
}

/** Varsayilan veri: infrastructure/fixtures.ts */
export const DEFAULT_CATALOG_DATA: InMemoryCatalogData = {
  categories: CATEGORIES,
  products: PRODUCTS,
  darkStoreIds: DARK_STORES.map((store) => store.id),
  assortment: STORE_ASSORTMENT,
};

export class InMemoryCatalogRepository implements CatalogRepository {
  private readonly data: InMemoryCatalogData;
  /** Sayfalama imleci sirali liste ister; bir kez siralanir. */
  private readonly sortedProducts: readonly Product[];

  constructor(data: InMemoryCatalogData = DEFAULT_CATALOG_DATA) {
    this.data = data;
    this.sortedProducts = sortProducts(data.products);
  }

  listCategories(): Promise<readonly Category[]> {
    return Promise.resolve(this.data.categories);
  }

  listProducts(filter: ProductFilter, page: PageQuery): Promise<ProductPage> {
    const matched = this.sortedProducts.filter((product) => this.matches(product, filter));
    const slice = sliceByCursor(matched, page.size, page.token);

    return Promise.resolve({ ...slice, totalSize: matched.length });
  }

  darkStoreExists(darkStoreId: string): Promise<boolean> {
    return Promise.resolve(this.data.darkStoreIds.includes(darkStoreId));
  }

  private matches(product: Product, filter: ProductFilter): boolean {
    if (filter.categoryId !== undefined && product.categoryId !== filter.categoryId) {
      return false;
    }
    if (filter.darkStoreId !== undefined) {
      const stocked = this.data.assortment[filter.darkStoreId] ?? [];
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
