/**
 * Use-case: katalogu demo verisiyle bastan yazar (pnpm seed).
 */

import { AppError } from '@getir/core';

import { MAX_CATEGORY_COUNT } from '../config/constants.js';
import type { CatalogSeedWriter, CatalogSnapshot, SeedCounts } from '../domain/catalog-snapshot.js';

export interface SeedCatalogDeps {
  readonly writer: CatalogSeedWriter;
  readonly snapshot: CatalogSnapshot;
  /** true ise seed REDDEDILIR. */
  readonly isProduction: boolean;
}

export type SeedCatalog = () => Promise<SeedCounts>;

export function createSeedCatalog(deps: SeedCatalogDeps): SeedCatalog {
  return async () => {
    // Seed "sil ve yeniden yaz"dir. Yanlis ortam degiskeniyle canli veritabanina
    // kosulursa tum katalogu demo verisiyle ezer; bu kapi o hatayi acilista durdurur.
    if (deps.isProduction) {
      throw AppError.forbidden('Seed production ortaminda calistirilamaz (NODE_ENV=production)');
    }

    // Kategori okumasi MAX_CATEGORY_COUNT'ta kesilir (D6). Kesme sessizce
    // kategori kaybettirmesin diye sinir YAZARKEN uygulanir: fazlasi hic yazilmaz.
    if (deps.snapshot.categories.length > MAX_CATEGORY_COUNT) {
      throw AppError.validation('Kategori sayisi ust siniri asiyor', {
        details: { categories: deps.snapshot.categories.length, max: MAX_CATEGORY_COUNT },
      });
    }

    await deps.writer.replaceAll(deps.snapshot);

    return {
      categories: deps.snapshot.categories.length,
      products: deps.snapshot.products.length,
      markets: deps.snapshot.markets.length,
      offers: deps.snapshot.offers.length,
    };
  };
}
