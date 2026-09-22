/**
 * Katalog deposunun ARAYUZU (port).
 *
 * Arayuz domain'de, uygulamasi infrastructure'da durur. Kazanci somut:
 * use-case testleri sahte bir depo ile bedavaya kosar (Mongo, Docker, ag yok)
 * ve T4.1'de Mongo uygulamasi geldiginde use-case'lerin TEK SATIRI degismedi.
 */

import type { Category, Product } from './catalog.js';
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

export interface CatalogRepository {
  listCategories(): Promise<readonly Category[]>;
  listProducts(filter: ProductFilter, page: PageQuery): Promise<ProductPage>;
  /** Depo katalogda tanimli mi? (Stok sorgusu DEGILDIR.) */
  darkStoreExists(darkStoreId: string): Promise<boolean>;
}
