/**
 * QA kara kutu (T15.3; #122, #124): kilidi dusmus siparis ve kaybolan odeme cevabi dunyasi.
 *
 * GERCEK: order'in gRPC sunucusu (buildOrderService; bellek deposu + outbox), payment-svc
 * (buildPaymentService; bellek deposu, mock saglayici), order'in GrpcPayments ve
 * GrpcStockReservations istemcileri (uretim dayanikliligi, islevsel 2 sn, #113), inventory
 * (Redis + Mongo), outbox aktaricisi (createRelayOutbox) ve payment'in komut tuketicileri. Ucu
 * AYNI sabit saati paylasir. catalog ve risk sahtedir.
 *
 * Konteynerler ve inventory dosya basina bir kez (useInventoryWorld). order ve payment HER TEST
 * icin yeniden kurulur (useShops): devre kesicinin sayaci, odeme kayitlari ve siparisler
 * testler arasinda tasinmasin. order + payment kurulumu iki kopyali kumeyle ortak
 * (qa-order-copy.ts). Ariza: qa-payment-faults.ts; denetim: qa-money-checks.ts.
 */

import { fixedClock, silentLogger } from '@getir/core';
import type { MutableClock } from '@getir/core';
import type { EventEnvelope, EventOutcome } from '@getir/event-bus';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { createSeedStock } from '../../../inventory-service/src/application/seed-stock.js';
import {
  buildInventoryService,
  buildSweepExpired,
} from '../../../inventory-service/src/bootstrap.js';
import type { StockStoresEnv } from '../../../inventory-service/src/config/env.js';
import type { StockLevel } from '../../../inventory-service/src/domain/stock.js';
import { MongoStockSeedWriter } from '../../../inventory-service/src/infrastructure/mongo/mongo-stock-seed-writer.js';
import type { StockSource } from '../../../inventory-service/src/infrastructure/stock-source.js';
import { openStockSource } from '../../../inventory-service/src/infrastructure/stock-source.js';
import type { StockStores } from '../../../inventory-service/src/infrastructure/stock-stores.js';
import { openStockStores } from '../../../inventory-service/src/infrastructure/stock-stores.js';
import { InMemoryPaymentStore } from '../../../payment-service/src/infrastructure/memory/in-memory-payment-store.js';
import { createRelayOutbox } from '../../src/application/relay-outbox.js';
import type { SweepRound } from '../../src/application/sweep-expired-reservations.js';
import { FAKE_MARKET_ID } from './fake-catalog-pricing.js';
import { FakeRiskAssessment } from './fake-risk-assessment.js';
import { nextUser } from './qa-order-calls.js';
import type { OrderCalls } from './qa-order-calls.js';
import {
  closeAll,
  deliverTo,
  paymentHandlers,
  startOrderCopy,
  startPayment,
} from './qa-order-copy.js';
import type { Closers } from './qa-order-copy.js';
import { FlakyPaidStore, PaymentFaults } from './qa-payment-faults.js';

export const MARKET = FAKE_MARKET_ID;
/** Taslak 2 x SUT-1L (order-fixtures.ts). */
export const SKU = 'SUT-1L';
export const DRAFT_QUANTITY = 2;
const ON_HAND = 100;
const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
/** Kilidin kesin dolmasi icin saat ilerletme: taslak 600 sn + odeme oncesi uzatmalar. */
export const PAST_LOCK_MS = 60 * 60 * 1_000;
const T0 = Date.parse('2026-10-07T12:00:00.000Z');

export interface InventoryWorld {
  readonly clock: MutableClock;
  readonly stores: StockStores;
  address(): string;
  /** Ayni Mongo konteyneri (order QA'si kendi veritabaniyla kullanir, ikinci konteyner acilmaz). */
  mongoUri(): string;
  /** Ayni Redis konteyneri (OQ7: order'in gercek sureci olay yayinini buraya yapar). */
  redisUrl(): string;
  /** inventory'nin supurucusu bir tur (kilidi dolan rezervasyonun stogu doner). */
  sweepInventory(): Promise<void>;
}

/**
 * Konteynerler, inventory deposu ve gRPC sunucusu: dosya basina bir kez. `onHand`: SKU'nun acilis
 * stogu; cok siparis acan dosya (OQ1) stok bitimine takilmasin diye buyutur.
 */
export function useInventoryWorld(dbName: string, onHand = ON_HAND): InventoryWorld {
  const levels: readonly StockLevel[] = [{ marketId: MARKET, sku: SKU, onHand }];
  const clock = fixedClock(T0);
  let mongo: StartedMongoDBContainer | undefined;
  let redis: StartedRedisContainer | undefined;
  let stores: StockStores | undefined;
  let source: StockSource | undefined;
  let server: TestGrpcServer | undefined;

  const mongoUri = () => `${need(mongo, 'mongo').getConnectionString()}?directConnection=true`;
  const redisUrl = () => need(redis, 'redis').getConnectionUrl();
  const storesEnv = (): StockStoresEnv => ({
    mongo: {
      uri: mongoUri(),
      dbName,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: 5_000,
    },
    redis: { REDIS_URL: redisUrl(), REDIS_CONNECT_TIMEOUT_MS: 5_000 },
  });

  beforeAll(async () => {
    // Sirayla: Docker bellek siniri altinda iki konteyner ayni anda acilmasin.
    mongo = await new MongoDBContainer(MONGO_IMAGE).start();
    redis = await new RedisContainer(REDIS_IMAGE).start();
    stores = await openStockStores(storesEnv(), silentLogger, `qa-${dbName}`);
    await createSeedStock({
      writer: new MongoStockSeedWriter(stores.mongo, stores.repository, stores.ledger),
      levels,
      isProduction: false,
    })();
    source = await openStockSource(storesEnv(), silentLogger);
    server = await startTestGrpcServer({
      serviceName: 'qa-inventory',
      logger: silentLogger,
      services: [buildInventoryService({ stock: source, clock })],
    });
  }, 120_000);

  afterAll(async () => {
    await closeAll([
      () => server?.stop(),
      () => source?.close(),
      () => stores?.close(),
      () => mongo?.stop(),
      () => redis?.stop(),
    ]);
  });

  return {
    clock,
    get stores() {
      return need(stores, 'inventory deposu');
    },
    address: () => `127.0.0.1:${need(server, 'inventory sunucusu').handle.port}`,
    mongoUri,
    redisUrl,
    sweepInventory: async () => {
      const opened = need(source, 'stok kaynagi');
      await buildSweepExpired({
        stock: opened,
        markets: opened.markets,
        clock,
        logger: silentLogger,
      })();
    },
  };
}

export interface ShopOptions {
  /**
   * order -> payment cagrisinin siniri. Varsayilan islevsel 2 sn (#113). Yalnizca kapida
   * bekletilen bir cagrinin ARKASINDAN baska bir istek kosan senaryo (K1, K2) genis verir:
   * sonuc saate degil kapiya bagli kalsin.
   */
  readonly paymentTimeoutMs?: number;
}

/** Bir testin order + payment'i ve senaryo adimlari (order cagrilari: qa-order-calls.ts). */
export interface Shop extends OrderCalls {
  readonly faults: PaymentFaults;
  readonly payments: InMemoryPaymentStore;
  readonly orders: FlakyPaidStore;
  /** Her cagri yeni kullanici (B22 kullanici kilidi testler arasinda tasinmasin). */
  nextUser(): string;
  /** order'in supurucusu bir tur. */
  sweepOrders(): Promise<SweepRound>;
  /** Outbox aktaricisi bir tur; payment komutlari (iade, iptal) tuketicilere verilir. */
  deliverPaymentCommands(): Promise<readonly { topic: string; outcome: EventOutcome }[]>;
}

/** order + payment HER TEST icin taze: `open()` testin icinde, acilanlar test sonunda kapanir. */
export function useShops(world: InventoryWorld): (options?: ShopOptions) => Promise<Shop> {
  const opened: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await closeAll(opened.splice(0));
  });
  return async (options = {}) => {
    const closers: Closers = [];
    const close = () => closeAll(closers.splice(0).reverse());
    opened.push(close);
    return openShop(world, options, closers);
  };
}

/** Kurulum ortak (qa-order-copy.ts); dunyaya ozgu olan: bellek deposu, sahte risk, akis. */
async function openShop(
  world: InventoryWorld,
  options: ShopOptions,
  closers: Closers,
): Promise<Shop> {
  const faults = new PaymentFaults();
  const payments = new InMemoryPaymentStore();
  const orders = new FlakyPaidStore();
  const paymentAddress = await startPayment({ payments, faults, clock: world.clock, closers });
  const copy = await startOrderCopy({
    name: 'qa-order',
    clock: world.clock,
    store: { repository: orders, history: orders, outbox: orders, expired: orders },
    risk: new FakeRiskAssessment(),
    paymentAddress,
    inventoryAddress: world.address(),
    paymentTimeoutMs: options.paymentTimeoutMs,
    closers,
  });
  const delivered: EventEnvelope[] = [];
  const relay = createRelayOutbox({
    outbox: orders,
    publisher: {
      publish: (envelope) => {
        delivered.push(envelope);
        return Promise.resolve();
      },
    },
    clock: world.clock,
    batchSize: 100,
  });
  const handlers = paymentHandlers(payments, world.clock);
  return {
    faults,
    payments,
    orders,
    nextUser,
    ...copy.calls,
    sweepOrders: () => copy.sweep(),
    deliverPaymentCommands: async () => {
      delivered.length = 0;
      await relay(silentLogger);
      return deliverTo(handlers, delivered);
    },
  };
}

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} henuz kurulmadi`);
  return value;
}
