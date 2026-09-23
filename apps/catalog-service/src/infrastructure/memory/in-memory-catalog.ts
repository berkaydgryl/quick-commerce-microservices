/**
 * MOCK modu (ADR-09): uc okuyucu, ayni demo verisinden.
 *
 * Mongo uygulamasiyla AYNI sozlesme testlerinden gecerler
 * (test/support/*-reader-contract.ts); MOCK modu ile gercek mod ayni sorguya
 * ayni cevabi verir.
 */

import { AppError } from '@getir/core';

import type { Offer, Product } from '../../domain/catalog.js';
import { offerIdFor } from '../../domain/catalog.js';
import type { CatalogSnapshot } from '../../domain/catalog-snapshot.js';
import type { CatalogReaders } from '../catalog-source.js';
import { CATALOG_SNAPSHOT } from '../fixtures.js';
import { InMemoryCategoryReader } from './in-memory-category-reader.js';
import { InMemoryMarketReader } from './in-memory-market-reader.js';
import { InMemoryOfferReader } from './in-memory-offer-reader.js';

export function createInMemoryReaders(
  snapshot: CatalogSnapshot = CATALOG_SNAPSHOT,
): CatalogReaders {
  return {
    categories: new InMemoryCategoryReader(snapshot.categories),
    markets: new InMemoryMarketReader(snapshot.markets),
    offers: new InMemoryOfferReader(joinOffers(snapshot)),
  };
}

/**
 * Seed bicimindeki teklifleri urunle birlestirir. Olmayan urune isaret eden
 * teklif SESSIZCE ATLANMAZ: veri hatasidir ve acilista patlamalidir (Mongo
 * tarafinda seeder ayni kontrolu yapar).
 */
function joinOffers(snapshot: CatalogSnapshot): readonly Offer[] {
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
