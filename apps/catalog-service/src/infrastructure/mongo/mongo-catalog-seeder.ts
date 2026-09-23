/**
 * Seed portunun (CatalogSeedWriter) Mongo uygulamasi.
 */

import type { MongoConnection } from '@getir/mongo-kit';

import type { CatalogSeedWriter, CatalogSnapshot } from '../../domain/catalog-snapshot.js';
import { toCategoryDocument, toDarkStoreDocument, toProductDocument } from './mappers.js';
import type { MongoCatalogRepositories } from './mongo-catalog.js';

export class MongoCatalogSeeder implements CatalogSeedWriter {
  private readonly connection: MongoConnection;
  private readonly repositories: MongoCatalogRepositories;

  constructor(connection: MongoConnection, repositories: MongoCatalogRepositories) {
    this.connection = connection;
    this.repositories = repositories;
  }

  /**
   * Uc koleksiyonu TEK transaction'da yeniden yazar: biri basarisiz olursa
   * hicbiri degismez. Yarim katalog (urunu olan ama kategorisi olmayan)
   * istemcide bos ekran uretirdi.
   */
  async replaceAll(snapshot: CatalogSnapshot): Promise<void> {
    const storesByProduct = invertAssortment(snapshot.assortment);
    const { categories, products, darkStores } = this.repositories;

    await this.connection.withTransaction(async (session) => {
      await categories.replaceAll(snapshot.categories.map(toCategoryDocument), { session });
      await products.replaceAll(
        snapshot.products.map((product) =>
          toProductDocument(product, storesByProduct.get(product.id) ?? []),
        ),
        { session },
      );
      await darkStores.replaceAll(snapshot.darkStores.map(toDarkStoreDocument), { session });
    });
  }
}

/** depo -> urunler tablosunu urun -> depolar tablosuna cevirir. */
function invertAssortment(
  assortment: Readonly<Record<string, readonly string[]>>,
): ReadonlyMap<string, readonly string[]> {
  const storesByProduct = new Map<string, string[]>();
  for (const [storeId, productIds] of Object.entries(assortment)) {
    for (const productId of productIds) {
      const stores = storesByProduct.get(productId) ?? [];
      stores.push(storeId);
      storesByProduct.set(productId, stores);
    }
  }
  // Deterministik belge: ayni seed her kosuda ayni diziyi yazsin.
  for (const stores of storesByProduct.values()) {
    stores.sort();
  }
  return storesByProduct;
}
