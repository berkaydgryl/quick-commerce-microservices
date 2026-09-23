/**
 * Seed portunun (CatalogSeedWriter) Mongo uygulamasi.
 */

import { AppError } from '@getir/core';
import type { MongoConnection } from '@getir/mongo-kit';

import type { Product } from '../../domain/catalog.js';
import type { CatalogSeedWriter, CatalogSnapshot } from '../../domain/catalog-snapshot.js';
import type { OfferDocument } from './documents.js';
import {
  toCategoryDocument,
  toMarketDocument,
  toOfferDocument,
  toProductDocument,
} from './mappers.js';
import type { MongoCatalogRepositories } from './mongo-catalog.js';

export class MongoCatalogSeeder implements CatalogSeedWriter {
  private readonly connection: MongoConnection;
  private readonly repositories: MongoCatalogRepositories;

  constructor(connection: MongoConnection, repositories: MongoCatalogRepositories) {
    this.connection = connection;
    this.repositories = repositories;
  }

  /**
   * Dort koleksiyonu TEK transaction'da yeniden yazar: biri basarisiz olursa
   * hicbiri degismez. Yarim katalog (teklifi olan ama urunu olmayan market)
   * istemcide bos ekran uretirdi.
   */
  async replaceAll(snapshot: CatalogSnapshot): Promise<void> {
    const offers = toOfferDocuments(snapshot);
    const { categories, products, markets, offers: offerRepository } = this.repositories;

    await this.connection.withTransaction(async (session) => {
      await categories.replaceAll(snapshot.categories.map(toCategoryDocument), { session });
      await products.replaceAll(snapshot.products.map(toProductDocument), { session });
      await markets.replaceAll(snapshot.markets.map(toMarketDocument), { session });
      await offerRepository.replaceAll(offers, { session });
    });
  }
}

/** Teklifleri urun kopyalariyla belgeye cevirir; olmayan urun veri hatasidir. */
function toOfferDocuments(snapshot: CatalogSnapshot): OfferDocument[] {
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
    return toOfferDocument(seed, product);
  });
}
