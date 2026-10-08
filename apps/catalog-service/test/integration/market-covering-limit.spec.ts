/**
 * Aday siniri kapsamadan SONRA (#175) - gercek Mongo (Testcontainers).
 *
 *   1. Sozlesme: bellek uygulamasiyla AYNI senaryolar ($geoNear + $match +
 *      $limit): yakin kapsamayanlarin arkasindaki genis market, sinirin
 *      kapsayanlara uygulanmasi, yaricap sinirinin iki yani.
 *   2. ListNearbyMarkets ve SearchNearby ayni kapsayanlari gorur.
 *   3. Sorgu plani: $geoNear 2dsphere indeksiyle (GEO_NEAR_2DSPHERE) okur.
 */

import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MARKET_CANDIDATE_LIMIT } from '../../src/config/constants.js';
import { createListNearbyMarkets } from '../../src/application/list-nearby-markets.js';
import { createSearchNearby } from '../../src/application/search-nearby.js';
import { createSeedCatalog } from '../../src/application/seed-catalog.js';
import type { Market } from '../../src/domain/catalog.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { coveringMarketsPipeline } from '../../src/infrastructure/mongo/market-repository.js';
import type { MongoCatalogRepositories } from '../../src/infrastructure/mongo/mongo-catalog.js';
import {
  createMongoCatalogRepositories,
  ensureCatalogIndexes,
} from '../../src/infrastructure/mongo/mongo-catalog.js';
import { MongoCatalogSeeder } from '../../src/infrastructure/mongo/mongo-catalog-seeder.js';
import { CLASSIC_SNAPSHOT } from '../support/classic-catalog.js';
import { describeCoveringLimitContract } from '../support/covering-limit-contract.js';
import { CROWDED_POINT, crowdedMarkets, WIDE_MARKET_ID } from '../support/crowded-markets.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_catalog_covering_test';

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let repositories: MongoCatalogRepositories;
let seeder: MongoCatalogSeeder;

/** Marketleri (tekliflerden bagimsiz) yazar ve market okuyucusunu doner. */
async function marketsOnly(markets: readonly Market[]) {
  await createSeedCatalog({
    writer: seeder,
    snapshot: { ...CLASSIC_SNAPSHOT, markets: [...markets], offers: [] },
    isProduction: false,
  })();
  return repositories.markets;
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    operationTimeoutMs: 2_000,
  });
  repositories = createMongoCatalogRepositories(connection.db);
  seeder = new MongoCatalogSeeder(connection, repositories);
  await ensureCatalogIndexes(repositories);
});

afterAll(async () => {
  await connection.close();
  await container.stop();
});

describeCoveringLimitContract('mongo', marketsOnly);

describe('aday siniri - gercek Mongo (#175)', () => {
  it('ListNearbyMarkets ve SearchNearby ayni kapsayanlari gorur', async () => {
    await marketsOnly(crowdedMarkets());

    const listed = await createListNearbyMarkets(repositories)(CROWDED_POINT);
    const wide = await createSearchNearby(repositories)({
      location: CROWDED_POINT,
      query: 'genis',
    });
    const near = await createSearchNearby(repositories)({
      location: CROWDED_POINT,
      query: 'yakin',
    });

    expect(listed.map((entry) => entry.market.id)).toEqual([WIDE_MARKET_ID]);
    expect(wide.map((result) => result.market.market.id)).toEqual([WIDE_MARKET_ID]);
    expect(near).toEqual([]);
  });

  it('sorgu plani: $geoNear 2dsphere indeksiyle (GEO_NEAR_2DSPHERE, location_2dsphere)', async () => {
    await marketsOnly(crowdedMarkets());

    const plan: unknown = await connection.db
      .collection(COLLECTIONS.MARKETS)
      .aggregate(coveringMarketsPipeline(CROWDED_POINT, MARKET_CANDIDATE_LIMIT))
      .explain('queryPlanner');

    // explain dis veridir ve surume gore iki bicimdedir: yalnizca metin olarak aranir.
    const text = JSON.stringify(plan);
    expect(text).toContain('GEO_NEAR_2DSPHERE');
    expect(text).toContain('location_2dsphere');
    expect(text).not.toContain('COLLSCAN');
  });
});
