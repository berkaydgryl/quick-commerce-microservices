/**
 * QA kara kutu (T15.2 geriye donuk tur, inventory PR 2; IQ6): komutlar ve acilis GERCEK surec
 * olarak (dist/seed.js, reseed.js, migrate.js, main.js; gercek Mongo + Redis). Islevleri
 * stock-stores.spec ve birim testleri surec icinde siner; burada cikis kodu, gunluk ve kalici
 * etki:
 *
 *   seed: 0; Mongo stogu, defter acilislari ve Redis sayaclari demo verisiyle; TEKRAR guvenli
 *     (bozulan sayac ve stok duzelir, acilis kaydi cogalmaz). production'da 1 ve HICBIR sey yazilmaz.
 *   reseed: Redis kaybindan sonra sayaclari kurar, defter tutuyor der (0); defterde eksik kayit
 *     varsa yine 0 ama B24 uyarisi ve fark sayisi.
 *   migrate: status/up/down 0, bilinmeyen komut 2; kodda olmayan uygulanmis goc status'u 1 yapar
 *     ve servisi ACMAZ (ADR-19).
 *   Acilis: allkeys-lru'lu Redis, ulasilamayan Redis ve Mongo -> cikis 1 (sure butcesi icinde),
 *     NEDENIYLE tek fatal satir, "hazir" satiri yok.
 *
 * Her test ihtiyac duydugu demo verisini kendisi yazar (seeded); bozdugu veriyi finally'de geri
 * kurar: biri duserse digerleri zincirleme kizarmaz, tek test de kosulabilir.
 */

import { silentLogger } from '@getir/core';
import { MIGRATE_EXIT, MIGRATIONS_COLLECTION } from '@getir/mongo-kit';
import type { MigrationRecord } from '@getir/mongo-kit';
import { STOCK_SEEDED_MARKER_KEY, stockAvailKey } from '@getir/redis-kit';
import { STARTUP_FAILURE_MESSAGE } from '@getir/service-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { REQUIRED_EVICTION_POLICY } from '../../src/config/constants.js';
import { LEDGER_KINDS } from '../../src/domain/stock-ledger.js';
import { STOCK_LEVELS } from '../../src/infrastructure/fixtures/stock-levels.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type {
  StockDocument,
  StockLedgerDocument,
} from '../../src/infrastructure/mongo/documents.js';
import type { StockStores } from '../../src/infrastructure/stock-stores.js';
import { openStockStores } from '../../src/infrastructure/stock-stores.js';
import {
  assertBuilt,
  ENTRY,
  logLines,
  READY_MESSAGE,
  runCli,
  startInventory,
  stopAllInventories,
} from '../support/qa-inventory-process.js';
import type { RunningInventory, StoresAddress } from '../support/qa-inventory-process.js';

const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const DB_NAME = 'qa_inventory_komutlar';
/** Ornek kalem: demo stogunda 24 (fixtures/stock-levels.ts). */
const SAMPLE = { marketId: 'mkt_migros-jet-moda', sku: 'SUT-1L', onHand: 24 } as const;
/** Kapali port: baglanti aninda reddedilir. */
const CLOSED_PORT_URL = { redis: 'redis://127.0.0.1:1', mongo: 'mongodb://127.0.0.1:1' } as const;
const STARTUP_EXIT_BUDGET_MS = 15_000;

let mongoContainer: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
let stores: StockStores;

function address(): StoresAddress {
  return {
    mongoUri: `${mongoContainer.getConnectionString()}?directConnection=true`,
    mongoDb: DB_NAME,
    redisUrl: redisContainer.getConnectionUrl(),
  };
}

beforeAll(async () => {
  assertBuilt();
  [mongoContainer, redisContainer] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  stores = await openStockStores(
    {
      mongo: {
        uri: address().mongoUri,
        dbName: DB_NAME,
        serverSelectionTimeoutMs: 5_000,
        operationTimeoutMs: 5_000,
      },
      redis: { REDIS_URL: address().redisUrl, REDIS_CONNECT_TIMEOUT_MS: 5_000 },
    },
    silentLogger,
    'qa-komutlar',
  );
}, 120_000);

afterEach(async () => {
  await stopAllInventories();
});

afterAll(async () => {
  await stores?.close();
  await Promise.all([mongoContainer?.stop(), redisContainer?.stop()]);
});

const stock = () => stores.mongo.db.collection<StockDocument>(COLLECTIONS.STOCK);
const ledger = () => stores.mongo.db.collection<StockLedgerDocument>(COLLECTIONS.STOCK_LEDGER);

async function sampleCounter(): Promise<string | null> {
  return stores.redis.redis.get(stockAvailKey(SAMPLE.marketId, SAMPLE.sku));
}

/** Butun demo kalemlerinin sayaci onHand'e esit mi (eksik anahtar da fark sayilir). */
async function countersMatchLevels(): Promise<number> {
  const values = await stores.redis.redis.mget(
    STOCK_LEVELS.map((level) => stockAvailKey(level.marketId, level.sku)),
  );
  return STOCK_LEVELS.filter((level, index) => values[index] !== String(level.onHand)).length;
}

/** Demo verisini (yeniden) yazar. */
async function seeded(): Promise<void> {
  const run = await runCli(ENTRY.SEED, [], address());
  if (run.code !== 0) throw new Error(`seed basarisiz:\n${run.output}`);
}

/** Acilmayan servis: cikis 1, butce icinde; NEDENIYLE tek fatal satir; "hazir" yok. */
function expectRefused(inventory: RunningInventory, cause: string): void {
  expect(inventory.ready).toBe(false);
  expect(inventory.exitCode).toBe(1);
  expect(inventory.elapsedMs).toBeLessThanOrEqual(STARTUP_EXIT_BUDGET_MS);
  const fatal = logLines(inventory.output(), STARTUP_FAILURE_MESSAGE);
  expect(fatal).toHaveLength(1);
  expect(JSON.stringify(fatal[0])).toContain(cause);
  expect(logLines(inventory.output(), READY_MESSAGE)).toEqual([]);
}

async function sampleOnHand(): Promise<number | undefined> {
  return (await stock().findOne({ marketId: SAMPLE.marketId, sku: SAMPLE.sku }))?.onHand;
}

describe('QA IQ6 seed komutu (gercek surec)', () => {
  it('seed: 0; stok, defter acilislari ve sayaclar demo verisiyle', async () => {
    const run = await runCli(ENTRY.SEED, [], address());

    expect(run.code).toBe(0);
    expect(logLines(run.output, 'stok seed tamamlandi')).toHaveLength(1);
    expect(await stock().countDocuments()).toBe(STOCK_LEVELS.length);
    expect(await ledger().countDocuments({ kind: LEDGER_KINDS.OPENING })).toBe(STOCK_LEVELS.length);
    expect(await countersMatchLevels()).toBe(0);
    expect(await stores.redis.redis.exists(STOCK_SEEDED_MARKER_KEY)).toBe(1);
  });

  it('seed tekrar guvenli: bozulan stok ve sayac duzelir, acilis kaydi cogalmaz', async () => {
    await seeded();
    await stock().updateOne(
      { marketId: SAMPLE.marketId, sku: SAMPLE.sku },
      { $set: { onHand: 999 } },
    );
    await stores.redis.redis.set(stockAvailKey(SAMPLE.marketId, SAMPLE.sku), '777');

    const run = await runCli(ENTRY.SEED, [], address());

    expect(run.code).toBe(0);
    expect(await sampleOnHand()).toBe(SAMPLE.onHand);
    expect(await sampleCounter()).toBe(String(SAMPLE.onHand));
    expect(await ledger().countDocuments({ kind: LEDGER_KINDS.OPENING })).toBe(STOCK_LEVELS.length);
    expect(await countersMatchLevels()).toBe(0);
  });

  it('production: 1 ve HICBIR sey yazilmaz (demo stogu uretime gitmez)', async () => {
    await seeded();
    await stock().updateOne(
      { marketId: SAMPLE.marketId, sku: SAMPLE.sku },
      { $set: { onHand: 5 } },
    );
    await stores.redis.redis.set(stockAvailKey(SAMPLE.marketId, SAMPLE.sku), '5');
    try {
      const run = await runCli(ENTRY.SEED, [], address(), { NODE_ENV: 'production' });

      expect(run.code).toBe(1);
      expect(logLines(run.output, 'stok seed basarisiz')).toHaveLength(1);
      expect(await sampleOnHand()).toBe(5);
      expect(await sampleCounter()).toBe('5');
    } finally {
      await seeded();
    }
  });
});

describe('QA IQ6 reseed komutu (gercek surec)', () => {
  it('Redis kaybindan sonra: 0; sayaclar kalici stoktan, defter tutuyor', async () => {
    await seeded();
    await stores.redis.redis.flushall();
    expect(await sampleCounter()).toBeNull();

    const run = await runCli(ENTRY.RESEED, [], address());

    expect(run.code).toBe(0);
    expect(logLines(run.output, 'stok sayaclari yeniden kuruldu')).toHaveLength(1);
    expect(logLines(run.output, 'stok defteri eldeki adetle tutuyor')).toHaveLength(1);
    expect(await countersMatchLevels()).toBe(0);
  });

  it('defterde eksik kayit: yine 0, ama B24 uyarisi ve tek fark', async () => {
    await seeded();
    const removed = await ledger().findOneAndDelete({
      kind: LEDGER_KINDS.OPENING,
      marketId: SAMPLE.marketId,
      sku: SAMPLE.sku,
    });
    expect(removed).not.toBeNull();
    try {
      const run = await runCli(ENTRY.RESEED, [], address());

      expect(run.code).toBe(0);
      expect(logLines(run.output, 'stok defteri eldeki adetle TUTMUYOR (B24)')).toEqual([
        expect.objectContaining({ mismatches: 1 }),
      ]);
      expect(await countersMatchLevels()).toBe(0);
    } finally {
      await seeded();
    }
  });
});

describe('QA IQ6 migrate komutu ve acilis (gercek surec)', () => {
  it('status, up, down: 0 (goc yok); bilinmeyen ya da eksik komut: 2', async () => {
    for (const command of ['status', 'up', 'up', 'down', 'status']) {
      expect((await runCli(ENTRY.MIGRATE, [command], address())).code).toBe(MIGRATE_EXIT.OK);
    }
    expect((await runCli(ENTRY.MIGRATE, ['yukari'], address())).code).toBe(MIGRATE_EXIT.USAGE);
    expect((await runCli(ENTRY.MIGRATE, [], address())).code).toBe(MIGRATE_EXIT.USAGE);
  });

  it('kodda olmayan uygulanmis goc: status 1 ve servis ACILMAZ, neden o goc (ADR-19)', async () => {
    const migrations = stores.mongo.db.collection<MigrationRecord>(MIGRATIONS_COLLECTION);
    await migrations.insertOne({
      _id: 1,
      name: '0001-geri-alinmis',
      appliedAt: new Date('2026-10-07T00:00:00.000Z'),
      durationMs: 1,
    });
    try {
      const status = await runCli(ENTRY.MIGRATE, ['status'], address());
      expect(status.code).toBe(MIGRATE_EXIT.FAILED);
      expect(status.output).toContain('0001-geri-alinmis');

      expectRefused(await startInventory(address()), '0001-geri-alinmis');
    } finally {
      await migrations.deleteOne({ _id: 1 });
    }
  });

  it('dogru ortamda acilir: "hazir" satiri (kontrol: asagidaki redler ortamdan)', async () => {
    const inventory = await startInventory(address());

    expect(inventory.ready).toBe(true);
    expect(logLines(inventory.output(), READY_MESSAGE)).toHaveLength(1);
  });

  it(`maxmemory-policy allkeys-lru: acilmaz (${REQUIRED_EVICTION_POLICY} zorunlu), sayaca yazmaz`, async () => {
    await stores.redis.redis.flushall();
    await stores.redis.redis.config('SET', 'maxmemory-policy', 'allkeys-lru');
    try {
      expectRefused(await startInventory(address()), 'allkeys-lru');
      expect(await sampleCounter()).toBeNull();
    } finally {
      await stores.redis.redis.config('SET', 'maxmemory-policy', REQUIRED_EVICTION_POLICY);
    }
  });

  it.each([
    ['Redis', { REDIS_URL: CLOSED_PORT_URL.redis }, 'Redis baglantisi kurulamadi'],
    [
      'Mongo',
      {
        INVENTORY_MONGO_URI: `${CLOSED_PORT_URL.mongo}/?directConnection=true`,
        MONGO_SERVER_SELECTION_TIMEOUT_MS: '1000',
      },
      'Mongo baglantisi kurulamadi',
    ],
  ])(
    '%s ulasilamaz: cikis 1, nedeniyle tek fatal satir, "hazir" yok',
    async (_name, extra, cause) => {
      expectRefused(await startInventory(address(), extra), cause);
    },
  );
});
