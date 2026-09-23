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
  listCategories(): Promise<readonly Category[]>;
}
