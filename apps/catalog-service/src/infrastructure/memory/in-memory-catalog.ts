/**
 * MOCK modu (ADR-09): uc okuyucu, ayni demo verisinden.
 *
 * Mongo uygulamasiyla AYNI sozlesme testlerinden gecerler
 * (test/support/*-reader-contract.ts); MOCK modu ile gercek mod ayni sorguya
 * ayni cevabi verir.
 */

import type { CatalogSnapshot } from '../../domain/catalog-snapshot.js';
import { joinOfferSeeds } from '../../domain/catalog-snapshot.js';
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
    // Olmayan urune isaret eden teklif acilista patlar (domain kurali).
    offers: new InMemoryOfferReader(joinOfferSeeds(snapshot)),
  };
}
