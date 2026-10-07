/**
 * QA kara kutu (T15.2 geriye donuk tur, inventory PR 2; IQ8): Redis baglantisi DONUNCA. Servis
 * Redis'e dondurulabilen bir TCP vekiliyle baglanir (mongo-kit freezing-proxy: baglanti acik,
 * veri iletilmez; cozulunce bekleyen veri sirasiyla akar = ag bolunmesi iyilesince TCP'nin yeniden
 * iletimi). Mongo dogrudandir. Denetimler Redis'e vekilsiz baglantiyla okunur.
 *
 *   - Donukken Reserve/Release istemcinin sure sinirinda DEADLINE_EXCEEDED; o sirada Redis'te
 *     HICBIR yazim yok (sayac, rezervasyon, indeks, kullanici kilidi).
 *   - Cozulunce yolda kalan komut UYGULANIR (gec yazim): istemci hata gorduyse de kilit alinmis
 *     ya da birakilmistir. Ayni orderId ile tekrar idempotent: "zaten rezerve" ilk bitisle,
 *     birakma ALREADY_APPLIED; stok TAM BIR kez hareket eder, defterde tek release.
 *   - Servis donmadan sonra kendiliginden duzelir: yeni siparis normal rezerve edilir.
 */

import { fixedClock, GRPC_STATUS, silentLogger } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import {
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
  userReservationKey,
} from '@getir/redis-kit';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { FreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import { createSeedStock } from '../../src/application/seed-stock.js';
import { buildInventoryService } from '../../src/bootstrap.js';
import type { StockStoresEnv } from '../../src/config/env.js';
import type { StockLevel } from '../../src/domain/stock.js';
import { LEDGER_KINDS } from '../../src/domain/stock-ledger.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { StockLedgerDocument } from '../../src/infrastructure/mongo/documents.js';
import { MongoStockSeedWriter } from '../../src/infrastructure/mongo/mongo-stock-seed-writer.js';
import type { StockSource } from '../../src/infrastructure/stock-source.js';
import { openStockSource } from '../../src/infrastructure/stock-source.js';
import type { StockStores } from '../../src/infrastructure/stock-stores.js';
import { openStockStores } from '../../src/infrastructure/stock-stores.js';
import { waitUntil } from '../support/qa-inventory-process.js';

const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const DB_NAME = 'qa_inventory_redis_donmasi';
const MARKET = 'mkt_qa-donma';
const SKU = 'QA-DONMA';
const ON_HAND = 30;
const QUANTITY = 3;
const LEVELS: readonly StockLevel[] = [{ marketId: MARKET, sku: SKU, onHand: ON_HAND }];
const TTL_SECONDS = 600;
/** order'in inventory sure siniriyla ayni olcek (INVENTORY_CALL_TIMEOUT_MS). */
const DEADLINE_MS = 1_000;
/** Cozulunce yolda kalan komutun uygulanmasi icin bekleme butcesi. */
const THAW_BUDGET_MS = 3_000;
const T0 = Date.parse('2026-10-07T11:00:00.000Z');
const service = inventoryV1.InventoryServiceService;

let mongoContainer: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
let stores: StockStores;
let proxy: FreezingProxy;
let source: StockSource;
let server: TestGrpcServer;
let client: Client;

function storesEnv(redisUrl: string): StockStoresEnv {
  return {
    mongo: {
      uri: `${mongoContainer.getConnectionString()}?directConnection=true`,
      dbName: DB_NAME,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: 5_000,
    },
    redis: { REDIS_URL: redisUrl, REDIS_CONNECT_TIMEOUT_MS: 5_000 },
  };
}

beforeAll(async () => {
  [mongoContainer, redisContainer] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  // Denetim ve tohum: vekilsiz.
  stores = await openStockStores(
    storesEnv(redisContainer.getConnectionUrl()),
    silentLogger,
    'qa-donma-denetim',
  );
  await createSeedStock({
    writer: new MongoStockSeedWriter(stores.mongo, stores.repository, stores.ledger),
    levels: LEVELS,
    isProduction: false,
  })();
  // Servis: Redis'e vekil uzerinden.
  proxy = await startFreezingProxy({
    host: redisContainer.getHost(),
    port: redisContainer.getMappedPort(6379),
  });
  source = await openStockSource(storesEnv(`redis://127.0.0.1:${proxy.port}`), silentLogger);
  server = await startTestGrpcServer({
    serviceName: 'qa-inventory-donma',
    logger: silentLogger,
    services: [buildInventoryService({ stock: source, clock: fixedClock(T0) })],
  });
  client = new Client(`127.0.0.1:${server.handle.port}`, credentials.createInsecure());
  // Isinma: gRPC kanali ve servisin Redis yolu donmadan ONCE kurulur. Soguk kanalda ilk cagrinin
  // suresi kurulumda tukenirse istek isleyiciye hic ulasmaz, gec yazim da olmaz (titreklik).
  const warm = await callWithDeadline(service.checkAvailability, {
    darkStoreId: '',
    marketId: MARKET,
    skus: [SKU],
  });
  if (warm.error !== undefined) throw new Error(`isinma cagrisi basarisiz: ${warm.error.message}`);
}, 120_000);

afterEach(() => {
  // Test yarida duserse servis donuk kalmasin.
  proxy?.thaw();
});

afterAll(async () => {
  client?.close();
  await server?.stop();
  await source?.close();
  await proxy?.close();
  await stores?.close();
  await Promise.all([mongoContainer?.stop(), redisContainer?.stop()]);
});

interface Result<TResponse> {
  readonly error: ServiceError | undefined;
  readonly response: TResponse | undefined;
}

/** Sure sinirli tipli cagri (order'in istemcisi gibi tek sinir, tekrar yok). */
function callWithDeadline<TRequest, TResponse>(
  method: MethodDefinition<TRequest, TResponse>,
  request: TRequest,
): Promise<Result<TResponse>> {
  return new Promise((resolve) => {
    client.makeUnaryRequest(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      request,
      new Metadata(),
      { deadline: Date.now() + DEADLINE_MS },
      (error, response) => {
        resolve({ error: error ?? undefined, response: response ?? undefined });
      },
    );
  });
}

const ids = (n: number) => {
  const hex = (0xd0a0 + n).toString(16).padStart(32, '0');
  return { orderId: `ord_${hex}`, userId: `usr_${hex}` };
};

function reserve(n: number) {
  return callWithDeadline(service.reserve, {
    ...ids(n),
    darkStoreId: '',
    marketId: MARKET,
    items: [{ sku: SKU, quantity: QUANTITY }],
    ttlSeconds: TTL_SECONDS,
  });
}

function release(n: number) {
  return callWithDeadline(service.release, {
    orderId: ids(n).orderId,
    darkStoreId: '',
    marketId: MARKET,
    reason: 'user_cancelled',
  });
}

async function counter(): Promise<number> {
  const raw = await stores.redis.redis.get(stockAvailKey(MARKET, SKU));
  if (raw === null) throw new Error('sayac anahtari yok');
  return Number(raw);
}

/** Rezervasyonun Redis izleri (vekilsiz okuma). */
async function traces(n: number) {
  const { orderId, userId } = ids(n);
  const redis = stores.redis.redis;
  return {
    hash: await redis.exists(reservationKey(MARKET, orderId)),
    indexed: await redis.zscore(reservationIndexKey(MARKET), orderId),
    userLock: await redis.get(userReservationKey(userId)),
  };
}

function releases(n: number): Promise<number> {
  return stores.mongo.db
    .collection<StockLedgerDocument>(COLLECTIONS.STOCK_LEDGER)
    .countDocuments({ marketId: MARKET, orderId: ids(n).orderId, kind: LEDGER_KINDS.RELEASE });
}

describe('QA IQ8 Redis donmasi: yazim yok, cozulunce tam bir kez', () => {
  it('donukken Reserve sure sinirinda duser ve iz birakmaz; cozulunce gec yazim, tekrar idempotent', async () => {
    const before = await counter();
    proxy.freeze();

    const frozen = await reserve(1);

    expect(frozen.error?.code).toBe(GRPC_STATUS.DEADLINE_EXCEEDED);
    expect(await counter()).toBe(before);
    expect(await traces(1)).toEqual({ hash: 0, indexed: null, userLock: null });

    proxy.thaw();
    // Yolda kalan komut uygulanir: istemci hata gordu ama kilit alindi (gec yazim).
    expect(
      await waitUntil(async () => (await counter()) === before - QUANTITY, THAW_BUDGET_MS),
    ).toBe(true);
    const late = await traces(1);
    expect(late).toMatchObject({ hash: 1, userLock: ids(1).orderId });
    expect(Number(late.indexed)).toBe(T0 + TTL_SECONDS * 1_000);

    // Ayni orderId ile tekrar: "zaten rezerve", ilk bitis; stok ikinci kez dusmez.
    const retry = await reserve(1);
    expect(retry.error).toBeUndefined();
    expect(retry.response).toEqual({
      expiresAt: new Date(T0 + TTL_SECONDS * 1_000),
      alreadyReserved: true,
    });
    expect(await counter()).toBe(before - QUANTITY);

    expect((await release(1)).error).toBeUndefined();
    expect(await counter()).toBe(before);
  });

  it('donukken Release sure sinirinda duser; cozulunce stok BIR kez doner, tekrar ALREADY_APPLIED', async () => {
    const before = await counter();
    expect((await reserve(2)).error).toBeUndefined();
    proxy.freeze();

    const frozen = await release(2);

    expect(frozen.error?.code).toBe(GRPC_STATUS.DEADLINE_EXCEEDED);
    expect(await counter()).toBe(before - QUANTITY);
    expect((await traces(2)).userLock).toBe(ids(2).orderId);

    proxy.thaw();
    expect(await waitUntil(async () => (await counter()) === before, THAW_BUDGET_MS)).toBe(true);
    // Gec tamamlanan isleyici defteri de yazar (Mongo donmadi).
    expect(await waitUntil(async () => (await releases(2)) === 1, THAW_BUDGET_MS)).toBe(true);

    const retry = await release(2);
    expect(retry.error).toBeUndefined();
    expect(retry.response?.outcome).toBe(
      inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_ALREADY_APPLIED,
    );
    expect(await counter()).toBe(before);
    expect(await releases(2)).toBe(1);
    expect((await traces(2)).userLock).toBeNull();
  });

  it('donma gecince servis kendiliginden duzelir: yeni siparis normal rezerve edilir', async () => {
    const before = await counter();
    proxy.freeze();
    // Donma gercekten etkili: cagri sure sinirinda duser (yoksa "duzelme" iddiasi bos kalir).
    expect((await reserve(3)).error?.code).toBe(GRPC_STATUS.DEADLINE_EXCEEDED);
    proxy.thaw();
    expect(
      await waitUntil(async () => (await counter()) === before - QUANTITY, THAW_BUDGET_MS),
    ).toBe(true);

    const fresh = await reserve(4);

    expect(fresh.error).toBeUndefined();
    expect(fresh.response?.alreadyReserved).toBe(false);
    expect(await counter()).toBe(before - 2 * QUANTITY);
    await release(3);
    await release(4);
    expect(await counter()).toBe(before);
  });
});
