/**
 * Kategori okuma portu. Uygulamalari infrastructure'dadir (bellek, Mongo).
 *
 * NEDEN AYRI PORT: onceki surumde kategori, urun ve depo tek bir
 * CatalogRepository arayuzundeydi; her use-case uc konunun tamamina bagimliydi
 * ve arayuz her yeni RPC ile buyuyordu (Interface Segregation). Artik her
 * use-case yalnizca ihtiyac duydugu portu alir.
 */

import type { Category } from './catalog.js';

export interface CategoryReader {
  /**
   * En fazla `limit` kategori; kesilirse vitrin sirasinin (sortOrder, sonra
   * kimlik) BASINDAKILER kalir. Sinir cagirandadir (MAX_CATEGORY_COUNT):
   * liste sinirsiz okunmaz (D6).
   */
  listCategories(limit: number): Promise<readonly Category[]>;
}
