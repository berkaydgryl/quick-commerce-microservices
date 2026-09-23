/**
 * Katalogun Mongo uygulamasi - gercek Mongo (Testcontainers).
 *
 * Sahte istemciyle dogrulanamayan seyler burada sinanir:
 *   1. Sozlesme testleri: bellek uygulamasiyla AYNI senaryolar gercek sorguda
 *      (kategori, urun, depo - her okuyucu kendi sozlesmesiyle).
 *   2. Seed: sayilar, tekrar kosunun kopya uretmemesi, indeksler, tek transaction.
 *   3. ResolveDarkStore: 3 demo adresi ve kapali depo, 2dsphere uzerinden.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createResolveDarkStore } from '../../src/application/resolve-dark-store.js';
import { createSeedCatalog } from '../../src/application/seed-catalog.js';
import type { CatalogSnapshot } from '../../src/domain/catalog-snapshot.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { MongoCatalogRepositories } from '../../src/infrastructure/mongo/mongo-catalog.js';
import {
  createMongoCatalogRepositories,
  ensureCatalogIndexes,
} from '../../src/infrastructure/mongo/mongo-catalog.js';
import { MongoCatalogSeeder } from '../../src/infrastructure/mongo/mongo-catalog-seeder.js';
import { describeCategoryReaderContract } from '../support/category-reader-contract.js';
import { describeDarkStoreReaderContract } from '../support/dark-store-reader-contract.js';
import { DEMO_ADDRESSES, demoLocation, EXPECTED_NEAREST } from '../support/demo-addresses.js';
import { describeProductReaderContract } from '../support/product-reader-contract.js';

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
  expect(await countOf(COLLECTIONS.DARK_STORES)).toBe(2);
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
describeProductReaderContract('mongo', () => repositories.products);
describeDarkStoreReaderContract('mongo', () => repositories.darkStores);

describe('seed', () => {
  it('T4.1 olcutu: 5 kategori, 15 urun, 2 dark store yuklu', async () => {
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
    expect(await namesOf(COLLECTIONS.PRODUCTS)).toEqual([
      '_id_',
      'category_cursor',
      'sku_unique',
      'store_cursor',
    ]);
    expect(await namesOf(COLLECTIONS.DARK_STORES)).toEqual(['_id_', 'location_2dsphere']);
  });

  it('benzersiz slug gercekten zorlanir (CONFLICT)', async () => {
    // Ayni slug'i ("icecek") tasiyan ikinci kategori.
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
    // Bir onceki testteki basarisiz yazim urunleri de silmis olsaydi burada 0
    // gorurduk: kategori hatasi urun ve depo yazimini da geri almali.
    await expectDemoCounts();
  });
});

describe('ResolveDarkStore - gercek Mongo', () => {
  const resolve = (): ReturnType<typeof createResolveDarkStore> =>
    createResolveDarkStore({ darkStores: repositories.darkStores });

  afterEach(async () => {
    // Kapali depo testi veriyi degistirir; sonraki testler demo verisini gorsun.
    await seed();
  });

  it('adres dosyasi sozlesmedeki deliveryAddressSchema ya uyar ve 3 tanedir', () => {
    expect(DEMO_ADDRESSES.map((address) => address.title)).toEqual(['Ev', 'İş', 'Yazlık']);
  });

  it.each(['Ev', 'İş'] as const)('%s -> beklenen depo', async (title) => {
    const resolved = await resolve()(demoLocation(title));

    expect(resolved.store.id).toBe(EXPECTED_NEAREST[title].storeId);
    expect(resolved.distanceMeters).toBeLessThanOrEqual(resolved.store.deliveryRadiusMeters);
  });

  it('Yazlik -> NO_STORE (T4.2 olcutu), en yakin mesafeyle', async () => {
    const failing = resolve()(demoLocation('Yazlık'));

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({
      code: ERROR_CODES.NO_STORE,
      details: {
        reason: 'OUT_OF_RANGE',
        nearest_distance_meters: String(EXPECTED_NEAREST.Yazlık.meters),
      },
    });
  });

  it('kapsayan depo kapaliysa NO_STORE / STORE_CLOSED - Mongo sorgusu kapaliyi filtrelemez', async () => {
    // Sorgu isOpen'a gore filtreleseydi sonuc OUT_OF_RANGE olurdu: "yaricap
    // icinde ama kapali" ile "yaricap disi" ayirt edilemezdi.
    await seed({
      ...CATALOG_SNAPSHOT,
      darkStores: CATALOG_SNAPSHOT.darkStores.map((store) =>
        store.id === 'ds_kadikoy' ? { ...store, isOpen: false } : store,
      ),
    });

    await expect(resolve()(demoLocation('Ev'))).rejects.toMatchObject({
      code: ERROR_CODES.NO_STORE,
      details: {
        reason: 'STORE_CLOSED',
        nearest_distance_meters: String(EXPECTED_NEAREST.Ev.meters),
      },
    });
  });
});
