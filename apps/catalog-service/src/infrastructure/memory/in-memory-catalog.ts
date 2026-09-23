/**
 * MOCK modu (ADR-09): uc okuyucu, ayni demo verisinden.
 *
 * Mongo uygulamasiyla AYNI sozlesme testlerinden gecerler
 * (test/support/*-reader-contract.ts); MOCK modu ile gercek mod ayni sorguya
 * ayni cevabi verir.
 */

import type { CatalogSnapshot } from '../../domain/catalog-snapshot.js';
import type { CatalogReaders } from '../catalog-source.js';
import { CATALOG_SNAPSHOT } from '../fixtures.js';
import { InMemoryCategoryReader } from './in-memory-category-reader.js';
import { InMemoryDarkStoreReader } from './in-memory-dark-store-reader.js';
import { InMemoryProductReader } from './in-memory-product-reader.js';

export function createInMemoryReaders(
  snapshot: CatalogSnapshot = CATALOG_SNAPSHOT,
): CatalogReaders {
  return {
    categories: new InMemoryCategoryReader(snapshot.categories),
    products: new InMemoryProductReader(snapshot.products, snapshot.assortment),
    darkStores: new InMemoryDarkStoreReader(snapshot.darkStores),
  };
}
