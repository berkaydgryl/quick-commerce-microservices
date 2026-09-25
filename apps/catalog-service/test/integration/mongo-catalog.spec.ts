/**
 * Katalogun Mongo uygulamasi - gercek Mongo (Testcontainers). ADR-15.
 *
 * Sahte istemciyle dogrulanamayan seyler burada sinanir:
 *   1. Sozlesme testleri: bellek uygulamasiyla AYNI senaryolar gercek sorguda
 *      (kategori, market, teklif - her okuyucu kendi sozlesmesiyle).
 *   2. Seed: sayilar, tekrar kosunun kopya uretmemesi, indeksler, tek transaction.
 *   3. Pazaryeri: 3 demo adresi 2dsphere uzerinden beklenen marketleri listeler,
 *      kapali market listede kalir.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createBatchGetOffers } from '../../src/application/batch-get-offers.js';
import { createListNearbyMarkets } from '../../src/application/list-nearby-markets.js';
import { createSeedCatalog } from '../../src/application/seed-catalog.js';
import type { CatalogSnapshot } from '../../src/domain/catalog-snapshot.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { OfferDocument } from '../../src/infrastructure/mongo/documents.js';
import type { MongoCatalogRepositories } from '../../src/infrastructure/mongo/mongo-catalog.js';
import {
  createMongoCatalogRepositories,
  ensureCatalogIndexes,
} from '../../src/infrastructure/mongo/mongo-catalog.js';
import { MongoCatalogSeeder } from '../../src/infrastructure/mongo/mongo-catalog-seeder.js';
import { offersByProductIdsFilter } from '../../src/infrastructure/mongo/offer-repository.js';
import { describeCategoryReaderContract } from '../support/category-reader-contract.js';
import { DEMO_ADDRESSES, demoLocation, EXPECTED_NEARBY } from '../support/demo-addresses.js';
import { describeMarketReaderContract } from '../support/market-reader-contract.js';
import { describeOfferReaderContract } from '../support/offer-reader-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_catalog_test';

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let repositories: MongoCatalogRepositories;
let seeder: MongoCatalogSeeder;

async function seed(snapshot: CatalogSnapshot = CATALOG_SNAPSHOT): Promise<void> {
  await createSeedCatalog({ writer: seeder, snapshot, isProduction: false })();
}

async function countOf(name: string): Promise<number> {
  return connection.db.collection(name).countDocuments();
}

async function expectDemoCounts(): Promise<void> {
  expect(await countOf(COLLECTIONS.CATEGORIES)).toBe(5);
  expect(await countOf(COLLECTIONS.PRODUCTS)).toBe(15);
  expect(await countOf(COLLECTIONS.MARKETS)).toBe(6);
  expect(await countOf(COLLECTIONS.OFFERS)).toBe(CATALOG_SNAPSHOT.offers.length);
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
  });
  repositories = createMongoCatalogRepositories(connection.db);
  seeder = new MongoCatalogSeeder(connection, repositories);
  await ensureCatalogIndexes(repositories);
  await seed();
});

afterAll(async () => {
  await connection.close();
  await container.stop();
});

describeCategoryReaderContract('mongo', () => repositories.categories);
describeMarketReaderContract('mongo', () => repositories.markets);
describeOfferReaderContract('mongo', () => repositories.offers);

describe('seed', () => {
  it('5 kategori, 15 urun, 6 market ve tum teklifler yuklu', async () => {
    await expectDemoCounts();
  });

  it('tekrar kosmak kopya uretmez', async () => {
    await seed();
    await seed();

    await expectDemoCounts();
  });

  it('bildirilen indeksler olusmus', async () => {
    const namesOf = async (name: string): Promise<string[]> =>
      (await connection.db.collection(name).indexes()).map((index) => index.name ?? '').sort();

    expect(await namesOf(COLLECTIONS.CATEGORIES)).toEqual(['_id_', 'slug_unique']);
    expect(await namesOf(COLLECTIONS.PRODUCTS)).toEqual(['_id_', 'sku_unique']);
    expect(await namesOf(COLLECTIONS.MARKETS)).toEqual(['_id_', 'location_2dsphere']);
    expect(await namesOf(COLLECTIONS.OFFERS)).toEqual([
      '_id_',
      'market_category_cursor',
      'market_cursor',
      'market_product_unique',
    ]);
  });

  it('eski dark store koleksiyonuna yazilmaz', async () => {
    const names = (await connection.db.listCollections().toArray()).map(
      (collection) => collection.name,
    );

    expect(names).not.toContain('darkstores');
  });

  it('benzersiz slug gercekten zorlanir (CONFLICT)', async () => {
    const duplicate = {
      id: 'cat_kopya',
      name: 'Kopya',
      slug: 'icecek',
      sortOrder: 9,
      imageUrl: '/img/x.png',
    };

    const failing = seeder.replaceAll({
      ...CATALOG_SNAPSHOT,
      categories: [...CATALOG_SNAPSHOT.categories, duplicate],
    });

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('basarisiz seed HICBIR koleksiyonu degistirmez (tek transaction)', async () => {
    await expectDemoCounts();
  });

  it('ayni market-urun ikilisine ikinci teklif CONFLICT (market_product_unique)', async () => {
    const [first] = CATALOG_SNAPSHOT.offers;
    if (first === undefined) throw new Error('demo verisinde teklif yok');

    // Ayni ikili iki kez: turetilen _id de ayni oldugu icin cakisma zaten
    // _id'de yakalanir; indeks, kimlik bicimi degisse bile ikiliyi korur.
    const failing = seeder.replaceAll({
      ...CATALOG_SNAPSHOT,
      offers: [...CATALOG_SNAPSHOT.offers, first],
    });

    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    await expectDemoCounts();
  });
});

describe('ListNearbyMarkets - gercek Mongo', () => {
  const listNearby = (): ReturnType<typeof createListNearbyMarkets> =>
    createListNearbyMarkets({ markets: repositories.markets });

  it('adres dosyasi sozlesmedeki deliveryAddressSchema ya uyar ve 3 tanedir', () => {
    expect(DEMO_ADDRESSES.map((address) => address.title)).toEqual(['Ev', 'İş', 'Yazlık']);
  });

  it.each(['Ev', 'İş', 'Yazlık'] as const)(
    '%s -> beklenen marketler, yakindan uzaga',
    async (title) => {
      const nearby = await listNearby()(demoLocation(title));
      const expected = EXPECTED_NEARBY[title];

      expect(nearby.map((entry) => entry.market.id)).toEqual(
        expected.map((entry) => entry.marketId),
      );
      nearby.forEach((entry, index) => {
        expect(
          Math.abs(entry.distanceMeters - (expected[index]?.meters ?? Number.NaN)),
        ).toBeLessThanOrEqual(1);
      });
    },
  );

  it('kapali market listede kalir (Is: A101 Abbasaga)', async () => {
    const nearby = await listNearby()(demoLocation('İş'));

    expect(nearby.find((entry) => entry.market.id === 'mkt_a101-abbasaga')?.market.isOpen).toBe(
      false,
    );
  });
});

/** explain() ciktisi dis veridir: zorlanmaz, semadan gecer; yalnizca KAZANAN plan okunur. */
const explainSchema = z.object({ queryPlanner: z.object({ winningPlan: z.unknown() }) });

/**
 * Kazanan plan agacindaki asamalar ve indeksler. Plan bicimi surumden surume
 * degisir (ic ice inputStage / inputStages); agac guvenli bicimde gezilir.
 * Reddedilen planlar (rejectedPlans) BILEREK okunmaz: indeksin orada gorunmesi
 * kullanildigi anlamina gelmez.
 */
function planStages(
  node: unknown,
  found: { stages: string[]; indexes: string[] } = { stages: [], indexes: [] },
) {
  if (Array.isArray(node)) {
    node.forEach((child) => planStages(child, found));
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'stage' && typeof value === 'string') found.stages.push(value);
      else if (key === 'indexName' && typeof value === 'string') found.indexes.push(value);
      else planStages(value, found);
    }
  }
  return found;
}

describe('BatchGetOffers - gercek Mongo (T9.3)', () => {
  it('deponun GERCEK filtresi market_product_unique ile okunur; kazanan planda koleksiyon taramasi yok', async () => {
    const plan: unknown = await connection.db
      .collection<OfferDocument>(COLLECTIONS.OFFERS)
      .find(
        offersByProductIdsFilter('mkt_migros-jet-moda', [
          'prd_sut-1l',
          'prd_kola-1l',
          'prd_elma-1k',
        ]),
      )
      .explain('queryPlanner');

    const { stages, indexes } = planStages(explainSchema.parse(plan).queryPlanner.winningPlan);
    expect(stages).toContain('IXSCAN');
    expect(stages).not.toContain('COLLSCAN');
    expect(indexes).toEqual(['market_product_unique']);
  });

  it('15 urunluk Migros sepeti tek cagrida: 14 satilabilir, pasif camasir suyu missing', async () => {
    const productIds = (
      await repositories.offers.listOffers(
        { marketId: 'mkt_migros-jet-moda' },
        { size: 50, token: '' },
      )
    ).items.map((offer) => offer.product.id);
    const batch = createBatchGetOffers({
      offers: repositories.offers,
      markets: repositories.markets,
    });

    const result = await batch({ marketId: 'mkt_migros-jet-moda', productIds });

    expect(productIds).toHaveLength(15);
    expect(result.offers).toHaveLength(14);
    expect(result.missing).toEqual(['prd_camasir-suyu']);
  });
});
