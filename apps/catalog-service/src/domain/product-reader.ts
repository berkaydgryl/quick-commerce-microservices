/**
 * Urun okuma portu (bkz. category-reader.ts: neden ayri port).
 */

import type { Product } from './catalog.js';
import type { PageSlice } from './pagination.js';

/** ListProducts filtreleri. Verilmeyen alan "filtreleme" demektir. */
export interface ProductFilter {
  readonly categoryId?: string;
  readonly darkStoreId?: string;
  readonly query?: string;
}

export interface PageQuery {
  readonly size: number;
  /** Onceki cevaptan gelen imlec; ilk sayfada bos. */
  readonly token: string;
}

/** Sayfa + toplam sayim. */
export interface ProductPage extends PageSlice<Product> {
  /** Filtreye uyan toplam kayit sayisi. */
  readonly totalSize: number;
}

export interface ProductReader {
  listProducts(filter: ProductFilter, page: PageQuery): Promise<ProductPage>;
}
