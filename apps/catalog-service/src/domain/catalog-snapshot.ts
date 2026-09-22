/**
 * Katalogun TAMAMI: seed'in yazdigi ve MOCK modunun okudugu veri.
 *
 * Tek bir deger olarak tasinmasinin sebebi seed'in atomik olmasi: kategori,
 * urun ve depo birlikte yazilir ya da hic yazilmaz. Yarim bir katalog (urunleri
 * olan ama kategorisi olmayan) istemcide bos kategori ekrani uretirdi.
 */

import type { Category, DarkStore, Product } from './catalog.js';

export interface CatalogSnapshot {
  readonly categories: readonly Category[];
  readonly products: readonly Product[];
  readonly darkStores: readonly DarkStore[];
  /**
   * Depo -> o depoda SATILAN urun kimlikleri (cesit bilgisi).
   * Stok DEGILDIR; adet inventory-svc'dedir (B27).
   */
  readonly assortment: Readonly<Record<string, readonly string[]>>;
}

/**
 * Katalogu bastan yazan depo (port). Uygulamasi infrastructure/mongo'dadir.
 *
 * "Ekle" degil "degistir": seed ikinci kez kosuldugunda ikinci bir kopya
 * olusmamali, katalog snapshot'taki hale gelmeli.
 */
export interface CatalogSeedWriter {
  replaceAll(snapshot: CatalogSnapshot): Promise<void>;
}

/** Seed sonrasi raporlanan sayilar. */
export interface SeedCounts {
  readonly categories: number;
  readonly products: number;
  readonly darkStores: number;
}
