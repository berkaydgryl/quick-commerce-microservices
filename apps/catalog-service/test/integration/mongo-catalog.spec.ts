/**
 * Katalogun Mongo uygulamasi - gercek Mongo (Testcontainers).
 *
 * Sahte istemciyle dogrulanamayan uc sey burada sinanir:
 *   1. Sozlesme testi: bellek uygulamasiyla AYNI senaryolar gercek sorguda.
 *   2. Seed: sayilar, tekrar kosunun kopya uretmemesi, indekslerin varligi.
 *   3. Geometri: 3 demo adresi 2dsphere indeksine karsi beklenen depoya duser.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { deliveryAddressSchema } from '@getir/contracts';
import { AppError, ERROR_CODES } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createSeedCatalog } from '../../src/application/seed-catalog.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import type { DarkStoreDocument } from '../../src/infrastructure/mongo/documents.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MongoCatalog } from '../../src/infrastructure/mongo/mongo-catalog.js';
import { describeCatalogRepositoryContract } from '../support/catalog-repository-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_catalog_test';

const ADDRESSES_PATH = fileURLToPath(
  new URL('../../../../infra/seed/data/addresses.json', import.meta.url),
);

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let catalog: MongoCatalog;

async function seed(): Promise<void> {
  await createSeedCatalog({ writer: catalog, snapshot: CATALOG_SNAPSHOT, isProduction: false })();
}

async function countOf(name: string): Promise<number> {
  return connection.db.collection(name).countDocuments();
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
  });
  catalog = new MongoCatalog(connection);
  await catalog.ensureIndexes();
  await seed();
});

afterAll(async () => {
  await connection.close();
  await container.stop();
});

describeCatalogRepositoryContract('mongo', () => catalog);

describe('seed', () => {
  it('T4.1 olcutu: 5 kategori, 15 urun, 2 dark store yuklu', async () => {
    expect(await countOf(COLLECTIONS.CATEGORIES)).toBe(5);
    expect(await countOf(COLLECTIONS.PRODUCTS)).toBe(15);
    expect(await countOf(COLLECTIONS.DARK_STORES)).toBe(2);
  });

  it('tekrar kosmak kopya uretmez', async () => {
    await seed();
    await seed();

    expect(await countOf(COLLECTIONS.CATEGORIES)).toBe(5);
    expect(await countOf(COLLECTIONS.PRODUCTS)).toBe(15);
    expect(await countOf(COLLECTIONS.DARK_STORES)).toBe(2);
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

    const failing = catalog.replaceAll({
      ...CATALOG_SNAPSHOT,
      categories: [...CATALOG_SNAPSHOT.categories, duplicate],
    });

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('basarisiz seed HICBIR koleksiyonu degistirmez (tek transaction)', async () => {
    // Bir onceki testteki basarisiz yazim urunleri de silmis olsaydi burada 0
    // gorurduk: kategori hatasi urun ve depo yazimini da geri almali.
    expect(await countOf(COLLECTIONS.CATEGORIES)).toBe(5);
    expect(await countOf(COLLECTIONS.PRODUCTS)).toBe(15);
    expect(await countOf(COLLECTIONS.DARK_STORES)).toBe(2);
  });
});

describe('3 hazir adres (infra/seed/data/addresses.json)', () => {
  const addresses = z
    .array(deliveryAddressSchema)
    .parse(JSON.parse(readFileSync(ADDRESSES_PATH, 'utf8')));

  /**
   * Adrese hizmet veren depolar: 2dsphere uzerinden mesafe, sonra depo
   * yaricapi. ResolveDarkStore'un KENDISI T4.2'dir; burada yalnizca verinin ve
   * indeksin bu soruyu cevaplayabildigi dogrulanir.
   */
  async function storesServing(lat: number, lng: number): Promise<string[]> {
    const nearest = await connection.db
      .collection<DarkStoreDocument>(COLLECTIONS.DARK_STORES)
      .aggregate<DarkStoreDocument & { distanceMeters: number }>([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [lng, lat] },
            distanceField: 'distanceMeters',
            spherical: true,
          },
        },
      ])
      .toArray();

    return nearest
      .filter((store) => store.distanceMeters <= store.deliveryRadiusMeters)
      .map((store) => store._id);
  }

  it('sozlesmedeki deliveryAddressSchema ya uyar ve 3 tanedir', () => {
    expect(addresses.map((address) => address.title)).toEqual(['Ev', 'İş', 'Yazlık']);
  });

  it.each([
    ['Ev', ['ds_kadikoy']],
    ['İş', ['ds_besiktas']],
    ['Yazlık', []],
  ])('%s -> %j', async (title, expected) => {
    const address = addresses.find((candidate) => candidate.title === title);
    expect(address).toBeDefined();
    if (address === undefined) return;

    expect(await storesServing(address.location.lat, address.location.lng)).toEqual(expected);
  });
});
