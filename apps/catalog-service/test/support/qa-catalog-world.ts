/**
 * QA (T15.2, catalog geriye donuk PR 1): gercek Mongo (Testcontainers) uzerinde catalog kopyalari.
 *
 * Her katalog kendi veritabaninda acilir; kopyalar uretimin acilisiyla (openCatalogSource: gocler,
 * indeksler) ve gercek gRPC'yle calisir. Veri uretimin seed yazicisiyla (MongoCatalogSeeder, dort
 * koleksiyon tek transaction) yazilir. Sentetik marketler gercek bir fixture marketinin kopyasidir:
 * yalnizca kimlik, ad, konum, yaricap ve acik/kapali degisir.
 */

import { silentLogger } from '@getir/core';
import type { GeoPoint } from '@getir/core';
import { connectMongo, mongoEnvSchemaFor } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { buildCatalogService } from '../../src/bootstrap.js';
import { DEFAULT_MONGO_DB } from '../../src/config/constants.js';
import type { Market } from '../../src/domain/catalog.js';
import type { CatalogSnapshot } from '../../src/domain/catalog-snapshot.js';
import { openCatalogSource } from '../../src/infrastructure/catalog-source.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { createMongoCatalogRepositories } from '../../src/infrastructure/mongo/mongo-catalog.js';
import { MongoCatalogSeeder } from '../../src/infrastructure/mongo/mongo-catalog-seeder.js';

const CONTAINER_START_TIMEOUT_MS = 120_000;
const TEMPLATE: Market | undefined = CATALOG_SNAPSHOT.markets[0];

/** Fixture marketinin kopyasi: kimlik `mkt_qa-<ad>`, verilen konum, yaricap ve acik/kapali. */
export function syntheticMarket(
  name: string,
  at: GeoPoint,
  deliveryRadiusMeters: number,
  isOpen = true,
): Market {
  if (TEMPLATE === undefined) throw new Error('fixture marketi yok');
  return {
    ...TEMPLATE,
    id: `mkt_qa-${name}`,
    name: `QA ${name}`,
    lat: at.lat,
    lng: at.lng,
    deliveryRadiusMeters,
    isOpen,
  };
}

/** Yalnizca marketlerden olusan katalog (kategoriler fixture'dan; urun ve teklif yok). */
export function marketsOnly(markets: readonly Market[]): CatalogSnapshot {
  return { categories: CATALOG_SNAPSHOT.categories, products: [], markets, offers: [] };
}

export interface OpenOptions {
  /** Kopya sayisi (ayni veritabani); varsayilan 1. */
  readonly copies?: number;
  /** true: dosya sonunda kapanir (salt okur testler ayni katalogu paylasir); yoksa test sonunda. */
  readonly shared?: boolean;
}

export interface CatalogWorld {
  /**
   * Taze veritabaninda catalog kopyalari acar (uretimin acilisi) ve katalogu seed eder.
   * @returns Kopyalarin gRPC sunuculari.
   */
  open(snapshot: CatalogSnapshot, options?: OpenOptions): Promise<TestGrpcServer[]>;
}

/** Dosyanin Mongo konteyneri ve test basina kapanislar; kapanislar hata guvenli. */
export function useCatalogWorld(prefix: string): CatalogWorld {
  let mongo: StartedMongoDBContainer | undefined;
  let databases = 0;
  const closers: (() => Promise<unknown>)[] = [];
  const sharedClosers: (() => Promise<unknown>)[] = [];

  beforeAll(async () => {
    mongo = await new MongoDBContainer('mongo:7').start();
  }, CONTAINER_START_TIMEOUT_MS);

  afterEach(async () => {
    await closeAll(closers);
  });

  afterAll(async () => {
    try {
      await closeAll(sharedClosers);
    } finally {
      await mongo?.stop();
    }
  });

  function envFor(dbName: string): MongoEnv {
    if (mongo === undefined) throw new Error('Mongo yok');
    const parsed = mongoEnvSchemaFor({ prefix: 'CATALOG', defaultDb: DEFAULT_MONGO_DB }).safeParse({
      CATALOG_MONGO_URI: `${mongo.getConnectionString()}?directConnection=true`,
      CATALOG_MONGO_DB: dbName,
    });
    if (!parsed.success) throw new Error(`Mongo ortami gecersiz: ${parsed.error.message}`);
    return parsed.data;
  }

  async function seed(env: MongoEnv, snapshot: CatalogSnapshot): Promise<void> {
    const connection = await connectMongo({ ...env, appName: 'qa-catalog-seed' });
    try {
      const seeder = new MongoCatalogSeeder(
        connection,
        createMongoCatalogRepositories(connection.db),
      );
      await seeder.replaceAll(snapshot);
    } finally {
      await connection.close();
    }
  }

  return {
    async open(snapshot, options = {}) {
      databases += 1;
      const env = envFor(`${prefix}_${String(databases)}`);
      const owned = options.shared === true ? sharedClosers : closers;
      const servers: TestGrpcServer[] = [];
      for (let index = 0; index < (options.copies ?? 1); index += 1) {
        const source = await openCatalogSource(env, silentLogger);
        owned.push(() => source.close());
        const server = await startTestGrpcServer({
          serviceName: `qa-catalog-${String(index)}`,
          logger: silentLogger,
          services: [buildCatalogService({ readers: source.readers, logger: silentLogger })],
        });
        owned.push(() => server.stop());
        servers.push(server);
      }
      await seed(env, snapshot);
      return servers;
    },
  };
}

/** Her kapanis denenir (biri dusse de digerleri), ters sirada; hatalar sonda birlikte. */
async function closeAll(list: (() => Promise<unknown>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const close of list.splice(0).reverse()) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'kapanis dustu');
}
