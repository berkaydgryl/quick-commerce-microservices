/**
 * Katalogun gocleri gercek Mongo'da (T10.4, ADR-19). Goc 0001 eski (T9.4
 * oncesi, katlanmamis) arama terimlerini katlar; acilistaki "pnpm seed
 * calistirin" uyarisinin yerini alir. Bitti tanimi: up -> down -> up ayni
 * semayi verir.
 */

import { silentLogger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { connectMongo, createMigrationRunner, MIGRATIONS_COLLECTION } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { AnyBulkWriteOperation } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSeedCatalog } from '../../src/application/seed-catalog.js';
import { openCatalogSource } from '../../src/infrastructure/catalog-source.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { OfferDocument } from '../../src/infrastructure/mongo/documents.js';
import {
  createMongoCatalogRepositories,
  ensureCatalogIndexes,
} from '../../src/infrastructure/mongo/mongo-catalog.js';
import type { MongoCatalogRepositories } from '../../src/infrastructure/mongo/mongo-catalog.js';
import { MongoCatalogSeeder } from '../../src/infrastructure/mongo/mongo-catalog-seeder.js';
import { MIGRATIONS } from '../../src/migrations/index.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_catalog_goc_test';
const MODA = 'mkt_migros-jet-moda';

let container: StartedMongoDBContainer;
let uri: string;
let connection: MongoConnection;
let repositories: MongoCatalogRepositories;

const offers = () => connection.db.collection<OfferDocument>(COLLECTIONS.OFFERS);
const runner = (logger = silentLogger) =>
  createMigrationRunner({ connection, migrations: MIGRATIONS, logger });

/** Teklif kimligi -> arama terimleri. */
async function termsById(): Promise<Record<string, string[]>> {
  const all = await offers()
    .find({}, { projection: { searchTerms: 1 }, sort: { _id: 1 } })
    .toArray();
  return Object.fromEntries(all.map((offer) => [offer._id, offer.searchTerms]));
}

/** T9.4 oncesi seed'in yazdigi bicim: kucuk harf, Turkce karakterler katlanmamis. */
async function writeLegacyTerms(): Promise<void> {
  const all = await offers()
    .find({}, { projection: { product: 1 } })
    .toArray();
  const updates: AnyBulkWriteOperation<OfferDocument>[] = all.map((offer) => ({
    updateOne: {
      filter: { _id: offer._id },
      update: {
        $set: {
          searchTerms: [
            offer.product.name.trim().toLocaleLowerCase('tr'),
            offer.product.description.trim().toLocaleLowerCase('tr'),
          ],
        },
      },
    },
  }));
  await offers().bulkWrite(updates);
}

async function finds(query: string, sku: string): Promise<boolean> {
  const page = await repositories.offers.listOffers(
    { marketId: MODA, query },
    { size: 50, token: '' },
  );
  return page.items.some((offer) => offer.product.sku === sku);
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  uri = `${container.getConnectionString()}?directConnection=true`;
  connection = await connectMongo({ uri, dbName: DB_NAME });
  repositories = createMongoCatalogRepositories(connection.db);
});

beforeEach(async () => {
  await connection.db.dropDatabase();
  await ensureCatalogIndexes(repositories);
  await createSeedCatalog({
    writer: new MongoCatalogSeeder(connection, repositories),
    snapshot: CATALOG_SNAPSHOT,
    isProduction: false,
  })();
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describe('goc 0001: arama terimlerini katla (T10.4)', () => {
  it("eski bicimli terimler servis ACILISINDA katlanir: seed'in bugunku bicimiyle ayni; arama bulur, kayit yazilir", async () => {
    const current = await termsById();
    await writeLegacyTerms();
    expect(await finds('süt 1', 'SUT-1L')).toBe(false);

    const source = await openCatalogSource(
      { uri, dbName: DB_NAME, serverSelectionTimeoutMs: 5_000, operationTimeoutMs: 2_000 },
      silentLogger,
    );
    await source.close();

    expect(await termsById()).toEqual(current);
    expect(await finds('süt 1', 'SUT-1L')).toBe(true);
    expect(await connection.db.collection(MIGRATIONS_COLLECTION).find().toArray()).toMatchObject([
      { _id: 1, name: 'arama-terimlerini-katla' },
    ]);
  });

  it('bitti tanimi: up -> down -> up ayni semayi verir; down eski bicimi urun kopyasindan birebir uretir', async () => {
    const folded = await termsById();
    await writeLegacyTerms();
    const legacy = await termsById();
    expect(legacy).not.toEqual(folded);

    await runner().up();
    expect(await termsById()).toEqual(folded);
    await runner().down();
    expect(await termsById()).toEqual(legacy);
    await runner().up();
    expect(await termsById()).toEqual(folded);
  });

  it("zaten katlanmis veride hicbir teklifi degistirmez (seed'den sonra acilis zararsiz)", async () => {
    const lines: LogLine[] = [];

    await runner(recordingLogger(lines)).up();

    expect(
      lines.find((line) => line.message === 'arama terimleri yeniden yazildi')?.fields,
    ).toMatchObject({
      changed: 0,
      offers: CATALOG_SNAPSHOT.offers.length,
    });
  });
});
