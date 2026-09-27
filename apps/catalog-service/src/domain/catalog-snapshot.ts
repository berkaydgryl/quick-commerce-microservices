/**
 * Katalogun TAMAMI: seed'in yazdigi ve MOCK modunun okudugu veri (ADR-15).
 *
 * Tek bir deger olarak tasinmasinin sebebi seed'in atomik olmasi: kategori,
 * urun, market ve teklif birlikte yazilir ya da hic yazilmaz.
 */

import { AppError } from '@getir/core';

import type { Category, Market, Offer, Product } from './catalog.js';
import { offerIdFor } from './catalog.js';

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
 * Seed bicimindeki teklifleri urunleriyle birlestirir: bellek okuyucusu ve
 * Mongo seeder AYNI kurali bu fonksiyondan alir (onceden iki adaptorde kopyaydi).
 *
 * BUTUNLUK KURALI: olmayan urune isaret eden teklif SESSIZCE ATLANMAZ. Veri
 * hatasidir; bellek modunda acilista, Mongo'da seed transaction'i baslamadan
 * patlar - yarim katalog yazilmaz.
 */
export function joinOfferSeeds(snapshot: CatalogSnapshot): readonly Offer[] {
  const products = new Map<string, Product>(
    snapshot.products.map((product) => [product.id, product]),
  );
  return snapshot.offers.map((seed) => {
    const product = products.get(seed.productId);
    if (product === undefined) {
      throw AppError.internal(
        `teklif olmayan urune isaret ediyor: ${seed.marketId} -> ${seed.productId}`,
      );
    }
    return {
      id: offerIdFor(seed.marketId, seed.productId),
      marketId: seed.marketId,
      product,
      priceMinor: seed.priceMinor,
      isActive: seed.isActive,
    };
  });
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
