/**
 * Urun okuyucunun BELLEK uygulamasi. Mongo'daki karsiliklari birebir:
 *   - esitlik filtresi   -> { categoryId }
 *   - depo cesidi        -> { darkStoreIds: id }
 *   - metin aramasi      -> searchTerms uzerinde regex (searchKey ile normalize)
 *   - imlecli sayfalama  -> { _id: { $gt: token } } + sort({ _id: 1 }) + limit
 */

import type { Product } from '../../domain/catalog.js';
import { matchesQuery, sortProducts } from '../../domain/catalog.js';
import { sliceByCursor } from '../../domain/pagination.js';
import type {
  PageQuery,
  ProductFilter,
  ProductPage,
  ProductReader,
} from '../../domain/product-reader.js';

export class InMemoryProductReader implements ProductReader {
  /** Sayfalama imleci sirali liste ister; bir kez siralanir. */
  private readonly sortedProducts: readonly Product[];
  /** depo -> o depoda satilan urun kimlikleri (cesit; stok degil). */
  private readonly assortment: Readonly<Record<string, readonly string[]>>;

  constructor(
    products: readonly Product[],
    assortment: Readonly<Record<string, readonly string[]>>,
  ) {
    this.sortedProducts = sortProducts(products);
    this.assortment = assortment;
  }

  listProducts(filter: ProductFilter, page: PageQuery): Promise<ProductPage> {
    const matched = this.sortedProducts.filter((product) => this.matches(product, filter));
    const slice = sliceByCursor(matched, page.size, page.token);

    return Promise.resolve({ ...slice, totalSize: matched.length });
  }

  private matches(product: Product, filter: ProductFilter): boolean {
    if (filter.categoryId !== undefined && product.categoryId !== filter.categoryId) {
      return false;
    }
    if (filter.darkStoreId !== undefined) {
      const stocked = this.assortment[filter.darkStoreId] ?? [];
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
