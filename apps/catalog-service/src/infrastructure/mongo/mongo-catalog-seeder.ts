/**
 * Seed portunun (CatalogSeedWriter) Mongo uygulamasi.
 */

import type { MongoConnection } from '@getir/mongo-kit';

import type { CatalogSeedWriter, CatalogSnapshot } from '../../domain/catalog-snapshot.js';
import { joinOfferSeeds } from '../../domain/catalog-snapshot.js';
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
   *
   * Teklifler transaction'dan ONCE urunleriyle birlestirilir (domain kurali):
   * olmayan urune isaret eden teklif varsa hicbir koleksiyona dokunulmaz.
   */
  async replaceAll(snapshot: CatalogSnapshot): Promise<void> {
    const offers = joinOfferSeeds(snapshot).map(toOfferDocument);
    const { categories, products, markets, offers: offerRepository } = this.repositories;

    await this.connection.withTransaction(async (session) => {
      await categories.replaceAll(snapshot.categories.map(toCategoryDocument), { session });
      await products.replaceAll(snapshot.products.map(toProductDocument), { session });
      await markets.replaceAll(snapshot.markets.map(toMarketDocument), { session });
      await offerRepository.replaceAll(offers, { session });
    });
  }
}
