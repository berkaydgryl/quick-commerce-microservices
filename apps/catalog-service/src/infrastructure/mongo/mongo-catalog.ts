/**
 * Katalogun Mongo uygulamasi: uc repository'yi domain portlarina baglar.
 *
 * Tek is BAGLAMAK: sorgu repository'lerde, kural use-case'lerde. Bu sinif
 * CatalogRepository (okuma, gRPC uclari) ve CatalogSeedWriter (seed) portlarini
 * ayni baglanti uzerinden karsilar.
 */

import type { MongoConnection } from '@getir/mongo-kit';

import type {
  CatalogRepository,
  PageQuery,
  ProductFilter,
  ProductPage,
} from '../../domain/catalog-repository.js';
import type { Category } from '../../domain/catalog.js';
import type { CatalogSeedWriter, CatalogSnapshot } from '../../domain/catalog-snapshot.js';
import { CategoryRepository } from './category-repository.js';
import { DarkStoreRepository } from './dark-store-repository.js';
import { toCategoryDocument, toDarkStoreDocument, toProductDocument } from './mappers.js';
import { ProductRepository } from './product-repository.js';

export class MongoCatalog implements CatalogRepository, CatalogSeedWriter {
  private readonly connection: MongoConnection;
  private readonly categories: CategoryRepository;
  private readonly products: ProductRepository;
  private readonly darkStores: DarkStoreRepository;

  constructor(connection: MongoConnection) {
    this.connection = connection;
    this.categories = new CategoryRepository(connection.db);
    this.products = new ProductRepository(connection.db);
    this.darkStores = new DarkStoreRepository(connection.db);
  }

  /**
   * Indeksleri olusturur. Acilista ve seed'den ONCE cagrilir: indeks
   * transaction icinde olusturulamaz ve benzersizlik kurali ilk yazimdan
   * itibaren gecerli olmali.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.categories.ensureIndexes(),
      this.products.ensureIndexes(),
      this.darkStores.ensureIndexes(),
    ]);
  }

  listCategories(): Promise<readonly Category[]> {
    return this.categories.listAll();
  }

  listProducts(filter: ProductFilter, page: PageQuery): Promise<ProductPage> {
    return this.products.list(filter, page);
  }

  darkStoreExists(darkStoreId: string): Promise<boolean> {
    return this.darkStores.existsById(darkStoreId);
  }

  /**
   * Uc koleksiyonu TEK transaction'da yeniden yazar: biri basarisiz olursa
   * hicbiri degismez. Yarim katalog (urunu olan ama kategorisi olmayan)
   * istemcide bos ekran uretirdi.
   */
  async replaceAll(snapshot: CatalogSnapshot): Promise<void> {
    const storesByProduct = invertAssortment(snapshot.assortment);

    await this.connection.withTransaction(async (session) => {
      await this.categories.replaceAll(snapshot.categories.map(toCategoryDocument), { session });
      await this.products.replaceAll(
        snapshot.products.map((product) =>
          toProductDocument(product, storesByProduct.get(product.id) ?? []),
        ),
        { session },
      );
      await this.darkStores.replaceAll(snapshot.darkStores.map(toDarkStoreDocument), { session });
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
