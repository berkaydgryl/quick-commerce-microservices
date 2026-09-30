/**
 * Stok servisinin gercek Mongo ve Redis uygulamasi (Testcontainers; T9.1, T9.2).
 *
 * Sahte istemciyle dogrulanamayan seyler burada sinanir:
 *   1. Redis sayaclari bellektekiyle AYNI sozlesmeden gecer (MGET, SET NX).
 *   2. Seed: 71 kayit, tekrar kosu kopya uretmez, benzersiz indeks.
 *   3. Acilis: sayaclar Mongo'dan yazilir, VAR OLAN sayac ezilmez.
 *   4. T9.2 olcutu: "Redis silinip yeniden kurulur" (FLUSHALL -> reseed).
 *   5. P1: tahliye eden Redis'te (allkeys-lru) servis acilmaz.
 *   6. Bozuk ve negatif sayac: tahmin yurutulmez / gizlenmez.
 */

import { ERROR_CODES, silentLogger } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import { stockAvailKey } from '@getir/redis-kit';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSeedCounters } from '../../src/application/seed-counters.js';
import { createSeedStock } from '../../src/application/seed-stock.js';
import { buildInventoryService } from '../../src/bootstrap.js';
import type { StockStoresEnv } from '../../src/config/env.js';
import { STOCK_LEVELS } from '../../src/infrastructure/fixtures/stock-levels.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MongoStockSeedWriter } from '../../src/infrastructure/mongo/mongo-stock-seed-writer.js';
import { openStockSource } from '../../src/infrastructure/stock-source.js';
import type { StockStores } from '../../src/infrastructure/stock-stores.js';
import { openStockStores } from '../../src/infrastructure/stock-stores.js';
import { describeStockCounterContract } from '../support/stock-counter-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surumler. */
const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const DB_NAME = 'getir_inventory_test';
const MIGROS = 'mkt_migros-jet-moda';

let mongoContainer: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
let env: StockStoresEnv;
let stores: StockStores;

function storesEnv(redisUrl: string): StockStoresEnv {
  return {
    mongo: {
      MONGO_URI: `${mongoContainer.getConnectionString()}?directConnection=true`,
      MONGO_DB: DB_NAME,
      MONGO_SERVER_SELECTION_TIMEOUT_MS: 5_000,
    },
    redis: { REDIS_URL: redisUrl, REDIS_CONNECT_TIMEOUT_MS: 5_000 },
  };
}

async function seedStock(): Promise<void> {
  await createSeedStock({
    writer: new MongoStockSeedWriter(stores.mongo, stores.repository),
    levels: STOCK_LEVELS,
    isProduction: false,
  })();
}

const onHandOf = (sku: string): number =>
  STOCK_LEVELS.find((level) => level.marketId === MIGROS && level.sku === sku)?.onHand ?? -1;

beforeAll(async () => {
  [mongoContainer, redisContainer] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  env = storesEnv(redisContainer.getConnectionUrl());
  stores = await openStockStores(env, silentLogger, 'inventory-test');
  await seedStock();
});

afterAll(async () => {
  await stores.close();
  await Promise.all([mongoContainer.stop(), redisContainer.stop()]);
});

describeStockCounterContract('redis', async () => {
  await stores.redis.redis.flushall();
  return stores.counters;
});

describe('kalici stok (Mongo)', () => {
  it('seed 71 kayit yazar; tekrar kosmak kopya uretmez', async () => {
    await seedStock();
    await seedStock();

    expect(await stores.mongo.db.collection(COLLECTIONS.STOCK).countDocuments()).toBe(71);
  });

  it('market x sku benzersiz indeksli', async () => {
    const names = (await stores.mongo.db.collection(COLLECTIONS.STOCK).indexes())
      .map((index) => index.name)
      .sort();

    expect(names).toEqual(['_id_', 'stock_market_sku_unique']);
  });

  it('kayitlar kacar kacar ve eksiksiz okunur', async () => {
    const sizes: number[] = [];
    let total = 0;
    for await (const batch of stores.repository.batches(10)) {
      sizes.push(batch.length);
      total += batch.length;
    }

    expect(sizes).toEqual([10, 10, 10, 10, 10, 10, 10, 1]);
    expect(total).toBe(71);
  });
});

describe('acilis ve reseed (T9.2)', () => {
  beforeEach(async () => {
    await stores.redis.redis.flushall();
  });

  it('acilista sayaclar Mongo dan yazilir; VAR OLAN sayac ezilmez (rezervasyonu korur)', async () => {
    await stores.redis.redis.set(stockAvailKey(MIGROS, 'SUT-1L'), '5');

    const source = await openStockSource(env, silentLogger);
    try {
      expect(source.seeded).toEqual({ scanned: 71, written: 70 });
      const found = await source.counters.available(MIGROS, ['SUT-1L', 'PEYNIR-500']);
      expect(found.get('SUT-1L')).toBe(5);
      expect(found.get('PEYNIR-500')).toBe(onHandOf('PEYNIR-500'));
    } finally {
      await source.close();
    }
  });

  it('T9.2 olcutu: Redis silinip yeniden kurulur (FLUSHALL -> reseed)', async () => {
    const reseed = createSeedCounters({ levels: stores.repository, counters: stores.counters });
    await reseed('overwrite');
    await stores.redis.redis.flushall();
    expect((await stores.counters.available(MIGROS, ['SUT-1L'])).size).toBe(0);

    const result = await reseed('overwrite');

    expect(result).toEqual({ scanned: 71, written: 71 });
    expect((await stores.counters.available(MIGROS, ['SUT-1L'])).get('SUT-1L')).toBe(
      onHandOf('SUT-1L'),
    );
  });

  it('CheckAvailability gercek gRPC ve Redis sayaclariyla', async () => {
    await createSeedCounters({ levels: stores.repository, counters: stores.counters })('overwrite');
    const source = await openStockSource(env, silentLogger);
    const server = await startTestGrpcServer({
      serviceName: 'inventory-it',
      services: [buildInventoryService({ stock: source })],
    });
    try {
      const { error, response } = await server.call(
        inventoryV1.InventoryServiceService.checkAvailability,
        {
          darkStoreId: '',
          marketId: MIGROS,
          skus: ['CIKOLATA-80', 'KOLA-1L', 'YOK-1'],
        },
      );

      expect(error).toBeUndefined();
      expect(response?.items).toEqual([
        { sku: 'CIKOLATA-80', availableQuantity: 1 },
        { sku: 'KOLA-1L', availableQuantity: 0 },
      ]);
      expect(response?.unknownSkus).toEqual(['YOK-1']);
    } finally {
      await server.stop();
      await source.close();
    }
  });
});

describe('bozuk ve negatif sayac', () => {
  beforeEach(async () => {
    await stores.redis.redis.flushall();
  });

  it('negatif sayac (fazla satis izi) 0 doner, gizlenmez: uyari yazilir', async () => {
    await stores.redis.redis.set(stockAvailKey(MIGROS, 'SUT-1L'), '-3');

    expect((await stores.counters.available(MIGROS, ['SUT-1L'])).get('SUT-1L')).toBe(0);
  });

  it('tam sayi olmayan sayac INTERNAL: tahmin yurutulmez', async () => {
    await stores.redis.redis.set(stockAvailKey(MIGROS, 'SUT-1L'), 'bozuk');

    await expect(stores.counters.available(MIGROS, ['SUT-1L'])).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });
});

describe('P1: tahliye eden Redis', () => {
  it('maxmemory-policy allkeys-lru iken acilmaz; mesaj sebebi soyler', async () => {
    const evicting = await new RedisContainer(REDIS_IMAGE)
      .withCommand(['redis-server', '--maxmemory-policy', 'allkeys-lru'])
      .start();
    try {
      await expect(
        openStockStores(storesEnv(evicting.getConnectionUrl()), silentLogger, 'inventory-test'),
      ).rejects.toThrow(/allkeys-lru.*noeviction zorunlu/);
    } finally {
      await evicting.stop();
    }
  });

  it('varsayilan Redis (noeviction) ile acilir', async () => {
    const source = await openStockSource(env, silentLogger);
    await source.close();
  });
});
