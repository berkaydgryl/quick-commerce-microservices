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
 *   7. Stok defteri (T10.2, ADR-18): acilis kayitlari, defter = onHand, cift
 *      kayit yok (B14); gercek gRPC'de Release ve yarida kalan defterin
 *      tekrar gelen istekle tamamlanmasi.
 *   8. Onay (T10.2 PR 2): eldeki adet ve surum Mongo'da duser, defterde -adet;
 *      eksiye dusen adet; P3 (bekleyerek yeniden deneme, denemeler bitince
 *      CONFLICT ve ayni istegin tekrariyla tamamlanma); defter denetimi (B24).
 *   9. Supurucu (T10.3): sahte saatle "sure dolunca stok 2 sn icinde geri
 *      gelir"; defterde expire; suresi dolana onay NOT_FOUND, birakma ALREADY_APPLIED.
 */

import { AppError, ERROR_CODES, fixedClock, GRPC_STATUS, silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { inventoryV1 } from '@getir/proto';
import { reservationKey, STOCK_SEEDED_MARKER_KEY, stockAvailKey } from '@getir/redis-kit';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCheckLedger } from '../../src/application/check-ledger.js';
import { createSeedCounters } from '../../src/application/seed-counters.js';
import { createSeedStock } from '../../src/application/seed-stock.js';
import type { StockPorts } from '../../src/domain/stock-ports.js';
import { commitEntries, releaseEntries } from '../../src/domain/stock-ledger.js';
import { buildInventoryService, buildSweepExpired } from '../../src/bootstrap.js';
import type { StockStoresEnv } from '../../src/config/env.js';
import { STOCK_LEVELS } from '../../src/infrastructure/fixtures/stock-levels.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type {
  StockDocument,
  StockLedgerDocument,
} from '../../src/infrastructure/mongo/documents.js';
import { MongoStockCommitter } from '../../src/infrastructure/mongo/mongo-stock-committer.js';
import { MongoStockSeedWriter } from '../../src/infrastructure/mongo/mongo-stock-seed-writer.js';
import { openStockSource } from '../../src/infrastructure/stock-source.js';
import { startReservationSweeper } from '../../src/interfaces/workers/reservation-sweeper.js';
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
    writer: new MongoStockSeedWriter(stores.mongo, stores.repository, stores.ledger),
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
    const reseed = createSeedCounters({
      levels: stores.repository,
      counters: stores.counters,
      marker: stores.marker,
    });
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
    await createSeedCounters({
      levels: stores.repository,
      counters: stores.counters,
      marker: stores.marker,
    })('overwrite');
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

describe('Redis bosalinca kendiliginden kurulum (T10.1 PR 2, ADR-17)', () => {
  const service = inventoryV1.InventoryServiceService;
  const rebuildWarnings = (lines: readonly LogLine[]) =>
    lines.filter((line) => line.level === 'warn' && line.message.includes('yeniden yaziliyor'));

  async function running() {
    const lines: LogLine[] = [];
    const source = await openStockSource(env, recordingLogger(lines));
    const server = await startTestGrpcServer({
      serviceName: 'inventory-onarim-it',
      services: [buildInventoryService({ stock: source })],
    });
    return {
      lines,
      server,
      close: async () => {
        await server.stop();
        await source.close();
      },
    };
  }

  beforeEach(async () => {
    await stores.redis.redis.flushall();
  });

  it('acilis, seed ve reseed sayaclardan SONRA isareti koyar', async () => {
    const source = await openStockSource(env, silentLogger);
    await source.close();
    expect(await stores.redis.redis.exists(STOCK_SEEDED_MARKER_KEY)).toBe(1);

    await stores.redis.redis.flushall();
    await createSeedCounters({
      levels: stores.repository,
      counters: stores.counters,
      marker: stores.marker,
    })('overwrite');
    expect(await stores.redis.redis.exists(STOCK_SEEDED_MARKER_KEY)).toBe(1);
  });

  it('FLUSHALL sonrasi CheckAvailability dogru adetleri verir: sayaclar kendiliginden kurulur', async () => {
    const inventory = await running();
    try {
      await stores.redis.redis.flushall();

      const { error, response } = await inventory.server.call(service.checkAvailability, {
        darkStoreId: '',
        marketId: MIGROS,
        skus: ['SUT-1L', 'PEYNIR-500', 'YOK-1'],
      });

      expect(error).toBeUndefined();
      expect(response?.items).toEqual([
        { sku: 'SUT-1L', availableQuantity: onHandOf('SUT-1L') },
        { sku: 'PEYNIR-500', availableQuantity: onHandOf('PEYNIR-500') },
      ]);
      expect(response?.unknownSkus).toEqual(['YOK-1']);
      expect(await stores.redis.redis.exists(STOCK_SEEDED_MARKER_KEY)).toBe(1);
      expect(rebuildWarnings(inventory.lines)).toHaveLength(1);
    } finally {
      await inventory.close();
    }
  });

  it('FLUSHALL sonrasi Reserve calisir: sayac eldeki adetten duser', async () => {
    const inventory = await running();
    try {
      await stores.redis.redis.flushall();

      const { error, response } = await inventory.server.call(
        service.reserve,
        inventoryV1.ReserveRequest.fromPartial({
          orderId: 'ord_00000000000000000000000000000077',
          marketId: MIGROS,
          userId: 'usr_00000000000000000000000000000077',
          items: [{ sku: 'SUT-1L', quantity: 2 }],
          ttlSeconds: 600,
        }),
      );

      expect(error).toBeUndefined();
      expect(response?.alreadyReserved).toBe(false);
      expect(await stores.redis.redis.get(stockAvailKey(MIGROS, 'SUT-1L'))).toBe(
        String(onHandOf('SUT-1L') - 2),
      );
    } finally {
      await inventory.close();
    }
  });

  it('isaret yerindeyken gercekten bilinmeyen SKU kurulum TETIKLEMEZ', async () => {
    const inventory = await running();
    try {
      const { response } = await inventory.server.call(service.checkAvailability, {
        darkStoreId: '',
        marketId: MIGROS,
        skus: ['YOK-1'],
      });

      expect(response?.unknownSkus).toEqual(['YOK-1']);
      expect(rebuildWarnings(inventory.lines)).toEqual([]);
    } finally {
      await inventory.close();
    }
  });

  it('es zamanli 10 istek tek kurulumu bekler; hepsi dogru adedi alir', async () => {
    const inventory = await running();
    try {
      await stores.redis.redis.flushall();

      const answers = await Promise.all(
        Array.from({ length: 10 }, () =>
          inventory.server.call(service.checkAvailability, {
            darkStoreId: '',
            marketId: MIGROS,
            skus: ['SUT-1L'],
          }),
        ),
      );

      expect(answers.map((answer) => answer.response?.items[0]?.availableQuantity)).toEqual(
        Array.from({ length: 10 }, () => onHandOf('SUT-1L')),
      );
      expect(rebuildWarnings(inventory.lines)).toHaveLength(1);
    } finally {
      await inventory.close();
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

describe('stok defteri (T10.2, ADR-18)', () => {
  const service = inventoryV1.InventoryServiceService;
  const ORDER = 'ord_00000000000000000000000000000071';
  const USER = 'usr_00000000000000000000000000000071';
  const ledgerCollection = () =>
    stores.mongo.db.collection<StockLedgerDocument>(COLLECTIONS.STOCK_LEDGER);

  /** Market x SKU basina defter toplami ile stoktaki onHand: esit olmayanlar. */
  async function ledgerMismatches(): Promise<string[]> {
    const totals = new Map<string, number>();
    for await (const group of ledgerCollection().aggregate<{
      _id: { marketId: string; sku: string };
      total: number;
    }>([{ $group: { _id: { marketId: '$marketId', sku: '$sku' }, total: { $sum: '$delta' } } }])) {
      totals.set(`${group._id.marketId}/${group._id.sku}`, group.total);
    }
    const mismatches: string[] = [];
    for await (const stock of stores.mongo.db
      .collection<StockDocument>(COLLECTIONS.STOCK)
      .find({})) {
      const key = `${stock.marketId}/${stock.sku}`;
      if (totals.get(key) !== stock.onHand) {
        mismatches.push(`${key}: defter ${String(totals.get(key))}, onHand ${stock.onHand}`);
      }
    }
    return mismatches;
  }

  beforeEach(async () => {
    await stores.redis.redis.flushall();
    await seedStock();
  });

  it('seed defteri acilis kayitlariyla yazar: her market x SKU icin +onHand; defter toplami onHand ile tutar', async () => {
    expect(await ledgerCollection().countDocuments({ kind: 'opening' })).toBe(71);
    expect(await ledgerCollection().countDocuments()).toBe(71);
    expect(await ledgerMismatches()).toEqual([]);
  });

  it('tekrar seed defteri bastan yazar: kopya yok, eski siparis kayitlari gider', async () => {
    await stores.ledger.record(
      releaseEntries({
        marketId: MIGROS,
        orderId: ORDER,
        reason: 'user_cancelled',
        lines: [{ sku: 'SUT-1L', quantity: 2 }],
        at: new Date(),
      }),
    );

    await seedStock();

    expect(await ledgerCollection().countDocuments()).toBe(71);
    expect(await ledgerCollection().countDocuments({ orderId: ORDER })).toBe(0);
  });

  it('indeksler: siparisin sonucu (kismi) ve market x SKU x zaman', async () => {
    const indexes = await ledgerCollection().indexes();

    expect(indexes.map((index) => index.name).sort()).toEqual([
      '_id_',
      'ledger_market_sku_created',
      'ledger_order',
    ]);
    expect(indexes.find((index) => index.name === 'ledger_order')?.partialFilterExpression).toEqual(
      { orderId: { $exists: true } },
    );
  });

  it('ayni kayit ikinci kez yazilmaz (B14): ilk gerekce kalir; siparisin sonucu okunur', async () => {
    const entries = (reason: string) =>
      releaseEntries({
        marketId: MIGROS,
        orderId: ORDER,
        reason,
        lines: [
          { sku: 'SUT-1L', quantity: 2 },
          { sku: 'PEYNIR-500', quantity: 1 },
        ],
        at: new Date(),
      });

    await stores.ledger.record(entries('user_cancelled'));
    await Promise.all([
      stores.ledger.record(entries('payment_failed')),
      stores.ledger.record(entries('payment_failed')),
    ]);

    const saved = await ledgerCollection().find({ orderId: ORDER }).toArray();
    expect(saved.map((entry) => [entry.sku, entry.delta, entry.quantity, entry.reason])).toEqual(
      expect.arrayContaining([
        ['SUT-1L', 0, 2, 'user_cancelled'],
        ['PEYNIR-500', 0, 1, 'user_cancelled'],
      ]),
    );
    expect(saved).toHaveLength(2);
    expect(await stores.ledger.settlementOf(MIGROS, ORDER)).toBe('released');
    expect(await stores.ledger.settlementOf('mkt_a101-caferaga', ORDER)).toBeUndefined();
    expect(
      await stores.ledger.settlementOf(MIGROS, 'ord_00000000000000000000000000000099'),
    ).toBeUndefined();
    expect(await ledgerMismatches()).toEqual([]);
  });

  async function serve(stock: StockPorts, logger: Logger = silentLogger) {
    const server = await startTestGrpcServer({
      serviceName: 'inventory-defter-it',
      services: [buildInventoryService({ stock, logger })],
    });
    const reserve = (
      items: readonly { sku: string; quantity: number }[] = [
        { sku: 'SUT-1L', quantity: 2 },
        { sku: 'PEYNIR-500', quantity: 1 },
      ],
    ) =>
      server.call(
        service.reserve,
        inventoryV1.ReserveRequest.fromPartial({
          orderId: ORDER,
          marketId: MIGROS,
          userId: USER,
          items: [...items],
          ttlSeconds: 600,
        }),
      );
    const release = () =>
      server.call(
        service.release,
        inventoryV1.ReleaseRequest.fromPartial({
          orderId: ORDER,
          marketId: MIGROS,
          reason: 'user_cancelled',
        }),
      );
    const commit = () =>
      server.call(
        service.commit,
        inventoryV1.CommitRequest.fromPartial({ orderId: ORDER, marketId: MIGROS }),
      );
    return { server, reserve, release, commit };
  }

  const counter = async (sku: string) =>
    Number(await stores.redis.redis.get(stockAvailKey(MIGROS, sku)));

  it('gercek gRPC: Reserve -> Release APPLIED; defterde kalem basina birakma (delta 0); tekrar ALREADY_APPLIED', async () => {
    const source = await openStockSource(env, silentLogger);
    const { server, reserve, release } = await serve(source);
    try {
      expect((await reserve()).error).toBeUndefined();
      expect(await counter('SUT-1L')).toBe(onHandOf('SUT-1L') - 2);

      const first = await release();
      const again = await release();

      expect(first.response?.outcome).toBe(
        inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_APPLIED,
      );
      expect(again.response?.outcome).toBe(
        inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_ALREADY_APPLIED,
      );
      expect(await counter('SUT-1L')).toBe(onHandOf('SUT-1L'));
      expect(await counter('PEYNIR-500')).toBe(onHandOf('PEYNIR-500'));
      expect(
        await ledgerCollection().countDocuments({ orderId: ORDER, kind: 'release', delta: 0 }),
      ).toBe(2);
      expect(await ledgerMismatches()).toEqual([]);
    } finally {
      await server.stop();
      await source.close();
    }
  });

  it('defter yazilamazsa UNAVAILABLE ama sayaclar dondu; tekrar gelen istek defteri tamamlar, stok BIR kez', async () => {
    const source = await openStockSource(env, silentLogger);
    let failures = 1;
    const flakyLedger: StockPorts['ledger'] = {
      record: async (entries) => {
        if (failures > 0) {
          failures -= 1;
          throw new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Veritabanina ulasilamiyor');
        }
        await source.ledger.record(entries);
      },
      settlementOf: (marketId, orderId) => source.ledger.settlementOf(marketId, orderId),
    };
    const { server, reserve, release } = await serve({ ...source, ledger: flakyLedger });
    try {
      await reserve();

      const failed = await release();
      expect(failed.error?.code).toBe(GRPC_STATUS.UNAVAILABLE);
      expect(appErrorOf(failed.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
      expect(await counter('SUT-1L')).toBe(onHandOf('SUT-1L'));
      expect(await ledgerCollection().countDocuments({ orderId: ORDER })).toBe(0);

      const retried = await release();
      expect(retried.response?.outcome).toBe(
        inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_ALREADY_APPLIED,
      );
      expect(await counter('SUT-1L')).toBe(onHandOf('SUT-1L'));
      expect(await ledgerCollection().countDocuments({ orderId: ORDER, kind: 'release' })).toBe(2);
      // Defter tamamlaninca iz silindi (ADR-18).
      expect(await stores.redis.redis.exists(reservationKey(MIGROS, ORDER))).toBe(0);
    } finally {
      await server.stop();
      await source.close();
    }
  });

  // ---------- onay (T10.2 PR 2) ----------

  const {
    RESERVATION_OUTCOME_APPLIED,
    RESERVATION_OUTCOME_ALREADY_APPLIED,
    RESERVATION_OUTCOME_NOT_FOUND,
  } = inventoryV1.ReservationOutcome;
  const stockDoc = (sku: string) =>
    stores.mongo.db.collection<StockDocument>(COLLECTIONS.STOCK).findOne({ marketId: MIGROS, sku });

  it('gercek gRPC: Commit APPLIED; eldeki adet ve surum duser, defterde -adet, sayaclar AYNI; tekrar ALREADY_APPLIED, birakma NOT_FOUND', async () => {
    const source = await openStockSource(env, silentLogger);
    const { server, reserve, release, commit } = await serve(source);
    try {
      await reserve();
      const before = await stockDoc('SUT-1L');

      const first = await commit();
      const again = await commit();
      const releaseAfter = await release();

      expect(first.response?.outcome).toBe(RESERVATION_OUTCOME_APPLIED);
      expect(again.response?.outcome).toBe(RESERVATION_OUTCOME_ALREADY_APPLIED);
      expect(releaseAfter.response?.outcome).toBe(RESERVATION_OUTCOME_NOT_FOUND);
      const after = await stockDoc('SUT-1L');
      expect(after?.onHand).toBe(onHandOf('SUT-1L') - 2);
      expect(after?.version).toBe((before?.version ?? 0) + 1);
      expect(await counter('SUT-1L')).toBe(onHandOf('SUT-1L') - 2);
      expect(await ledgerCollection().findOne({ orderId: ORDER, sku: 'SUT-1L' })).toMatchObject({
        kind: 'commit',
        delta: -2,
        quantity: 2,
        reason: 'order_paid',
      });
      expect(await ledgerCollection().countDocuments({ orderId: ORDER })).toBe(2);
      expect(await ledgerMismatches()).toEqual([]);
      expect(await stores.redis.redis.exists(reservationKey(MIGROS, ORDER))).toBe(0);
    } finally {
      await server.stop();
      await source.close();
    }
  });

  it('eldeki adet eksiye duserse onay YINE yapilir ve UYARI yazilir; defter yine onHand ile tutar', async () => {
    const lines: LogLine[] = [];
    const source = await openStockSource(env, silentLogger);
    const { server, reserve, commit } = await serve(source, recordingLogger(lines));
    try {
      // Redis sayaci eldeki adetten fazla (kayma izi): rezervasyon eldekini asar.
      await stores.redis.redis.set(stockAvailKey(MIGROS, 'PEYNIR-500'), '10');
      expect((await reserve([{ sku: 'PEYNIR-500', quantity: 5 }])).error).toBeUndefined();

      expect((await commit()).response?.outcome).toBe(RESERVATION_OUTCOME_APPLIED);

      expect((await stockDoc('PEYNIR-500'))?.onHand).toBe(onHandOf('PEYNIR-500') - 5);
      expect(
        lines
          .filter((line) => line.level === 'warn' && line.message.includes('eksiye dustu'))
          .map((line) => [line.fields['sku'], line.fields['onHand']]),
      ).toEqual([['PEYNIR-500', onHandOf('PEYNIR-500') - 5]]);
      expect(await ledgerMismatches()).toEqual([]);
    } finally {
      await server.stop();
      await source.close();
    }
  });

  it("onay yazimi tekrar guvenli: ayni kayitlarla ikinci kez adet DUSMEZ (defter ayni transaction'da)", async () => {
    const committer = new MongoStockCommitter(
      stores.mongo,
      stores.repository,
      stores.ledger,
      silentLogger,
    );
    const entries = commitEntries({
      marketId: MIGROS,
      orderId: ORDER,
      lines: [{ sku: 'SUT-1L', quantity: 2 }],
      at: new Date(),
    });

    expect(await committer.commit(entries)).toEqual({ written: 1, negative: [] });
    expect(await committer.commit(entries)).toEqual({ written: 0, negative: [] });

    expect((await stockDoc('SUT-1L'))?.onHand).toBe(onHandOf('SUT-1L') - 2);
    expect(await ledgerMismatches()).toEqual([]);
  });

  /** Stok belgesine yazip COMMIT ETMEDEN bekleyen ikinci istemcinin transaction'i (eldeki adede dokunmaz). */
  async function holdStock(sku: string) {
    const other = await MongoClient.connect(env.mongo.MONGO_URI);
    const holder = other.startSession();
    holder.startTransaction();
    await other
      .db(DB_NAME)
      .collection<StockDocument>(COLLECTIONS.STOCK)
      .updateOne(
        { marketId: MIGROS, sku },
        { $set: { updatedAt: new Date() } },
        { session: holder },
      );
    return {
      commit: () => holder.commitTransaction(),
      abort: () => holder.abortTransaction(),
      close: async () => {
        await holder.endSession();
        await other.close();
      },
    };
  }

  it('P3: es zamanli yazimda onay BEKLEYEREK yeniden dener ve basarir', async () => {
    const lines: LogLine[] = [];
    const committer = new MongoStockCommitter(
      stores.mongo,
      stores.repository,
      stores.ledger,
      recordingLogger(lines),
    );
    const held = await holdStock('SUT-1L');
    try {
      const writing = committer.commit(
        commitEntries({
          marketId: MIGROS,
          orderId: ORDER,
          lines: [{ sku: 'SUT-1L', quantity: 2 }],
          at: new Date(),
        }),
      );
      await vi.waitFor(() => {
        expect(lines.some((line) => line.message.includes('yeniden deneniyor'))).toBe(true);
      });
      await held.commit();

      await expect(writing).resolves.toEqual({ written: 1, negative: [] });
      expect((await stockDoc('SUT-1L'))?.onHand).toBe(onHandOf('SUT-1L') - 2);
      expect(await ledgerMismatches()).toEqual([]);
    } finally {
      await held.close();
    }
  });

  it('P3: denemeler biterse CONFLICT; Redis izi durur, Mongo DEGISMEZ; ayni istegin tekrari onayi tamamlar (stok bir kez)', async () => {
    const source = await openStockSource(env, silentLogger);
    const { server, reserve, commit } = await serve(source);
    const held = await holdStock('SUT-1L');
    try {
      await reserve();

      const failed = await commit();
      expect(failed.error?.code).toBe(GRPC_STATUS.ABORTED);
      expect(appErrorOf(failed.error)?.code).toBe(ERROR_CODES.CONFLICT);
      expect(await stores.redis.redis.hget(reservationKey(MIGROS, ORDER), 'state')).toBe(
        'committed',
      );
      expect(await ledgerCollection().countDocuments({ orderId: ORDER })).toBe(0);
      expect((await stockDoc('PEYNIR-500'))?.onHand).toBe(onHandOf('PEYNIR-500'));

      await held.abort();
      const retried = await commit();

      expect(retried.response?.outcome).toBe(RESERVATION_OUTCOME_ALREADY_APPLIED);
      expect((await stockDoc('SUT-1L'))?.onHand).toBe(onHandOf('SUT-1L') - 2);
      expect((await stockDoc('PEYNIR-500'))?.onHand).toBe(onHandOf('PEYNIR-500') - 1);
      expect(await ledgerMismatches()).toEqual([]);
    } finally {
      await held.close();
      await server.stop();
      await source.close();
    }
  });

  it('defter denetimi (B24): seed sonrasi fark yok; defterden gecmeyen adet degisikligi raporlanir', async () => {
    const check = createCheckLedger({
      levels: stores.repository,
      ledger: stores.ledger,
      batchSize: 20,
    });
    expect(await check()).toEqual({ checked: 71, mismatches: [] });

    await stores.mongo.db
      .collection<StockDocument>(COLLECTIONS.STOCK)
      .updateOne({ marketId: MIGROS, sku: 'SUT-1L' }, { $inc: { onHand: -1 } });

    expect((await check()).mismatches).toEqual([
      {
        marketId: MIGROS,
        sku: 'SUT-1L',
        onHand: onHandOf('SUT-1L') - 1,
        ledger: onHandOf('SUT-1L'),
      },
    ]);
  });

  // ---------- supurucu (T10.3) ----------

  it('sure dolunca stok 2 sn icinde geri gelir (sahte saat); defterde expire; onay NOT_FOUND, birakma ALREADY_APPLIED', async () => {
    const start = Date.UTC(2026, 9, 1, 12, 0, 0);
    const clock = fixedClock(start);
    const source = await openStockSource(env, silentLogger);
    const server = await startTestGrpcServer({
      serviceName: 'inventory-supurucu-it',
      services: [buildInventoryService({ stock: source, clock })],
    });
    try {
      await server.call(
        service.reserve,
        inventoryV1.ReserveRequest.fromPartial({
          orderId: ORDER,
          marketId: MIGROS,
          userId: USER,
          items: [{ sku: 'SUT-1L', quantity: 2 }],
          ttlSeconds: 30,
        }),
      );
      expect(await counter('SUT-1L')).toBe(onHandOf('SUT-1L') - 2);

      // Sure doldu (sahte saatte 30 sn + 1); supurucu her saniye tarar.
      clock.advance(31_000);
      const sweeper = startReservationSweeper({
        lock: source.leader,
        sweep: buildSweepExpired({
          stock: source,
          markets: source.markets,
          logger: silentLogger,
          clock,
        }),
        intervalMs: 1_000,
        logger: silentLogger,
      });
      const startedAt = Date.now();
      try {
        await vi.waitFor(
          async () => {
            expect(await counter('SUT-1L')).toBe(onHandOf('SUT-1L'));
          },
          { timeout: 3_000, interval: 50 },
        );
        expect(Date.now() - startedAt).toBeLessThanOrEqual(2_000);
        await vi.waitFor(async () => {
          expect(await ledgerCollection().countDocuments({ orderId: ORDER, kind: 'expire' })).toBe(
            1,
          );
        });
      } finally {
        await sweeper.stop();
      }

      const commitAfter = await server.call(
        service.commit,
        inventoryV1.CommitRequest.fromPartial({ orderId: ORDER, marketId: MIGROS }),
      );
      const releaseAfter = await server.call(
        service.release,
        inventoryV1.ReleaseRequest.fromPartial({
          orderId: ORDER,
          marketId: MIGROS,
          reason: 'user_cancelled',
        }),
      );
      expect(commitAfter.response?.outcome).toBe(RESERVATION_OUTCOME_NOT_FOUND);
      expect(releaseAfter.response?.outcome).toBe(RESERVATION_OUTCOME_ALREADY_APPLIED);
      expect(await ledgerCollection().findOne({ orderId: ORDER })).toMatchObject({
        kind: 'expire',
        delta: 0,
        quantity: 2,
        reason: 'expired',
      });
      expect(await ledgerMismatches()).toEqual([]);
    } finally {
      await server.stop();
      await source.close();
    }
  });

  it('supurucunun market listesi Mongo stoktan: 6 market, sirali', async () => {
    const markets = await stores.repository.marketIds();

    expect(markets).toHaveLength(6);
    expect(markets).toEqual([...markets].sort());
    expect(markets).toContain(MIGROS);
  });
});
