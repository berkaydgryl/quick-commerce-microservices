/**
 * Katalogun TAMAMI: seed'in yazdigi ve MOCK modunun okudugu veri (ADR-15).
 *
 * Tek bir deger olarak tasinmasinin sebebi seed'in atomik olmasi: kategori,
 * urun, market ve teklif birlikte yazilir ya da hic yazilmaz.
 */

import type { Category, Market, Product } from './catalog.js';

/** Teklifin seed bicimi: urun kimlikle baglanir, kimligi turetilir. */
export interface OfferSeed {
  readonly marketId: string;
  readonly productId: string;
  readonly priceMinor: number;
  readonly isActive: boolean;
}

export interface CatalogSnapshot {
  readonly categories: readonly Category[];
  readonly products: readonly Product[];
  readonly markets: readonly Market[];
  readonly offers: readonly OfferSeed[];
}

/**
 * Katalogu bastan yazan depo (port). "Ekle" degil "degistir": seed ikinci kez
 * kosuldugunda ikinci bir kopya olusmamali.
 */
export interface CatalogSeedWriter {
  replaceAll(snapshot: CatalogSnapshot): Promise<void>;
}

/** Seed sonrasi raporlanan sayilar. */
export interface SeedCounts {
  readonly categories: number;
  readonly products: number;
  readonly markets: number;
  readonly offers: number;
}
