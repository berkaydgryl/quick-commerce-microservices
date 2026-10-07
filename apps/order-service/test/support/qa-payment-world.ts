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
 * testler arasinda tasinmasin. Ariza: qa-payment-faults.ts; denetim: qa-money-checks.ts.
 */

import { EVENTS, fixedClock, MOCK_THREEDS_CODE, silentLogger } from '@getir/core';
import type { MutableClock } from '@getir/core';
import type { EventEnvelope, EventOutcome } from '@getir/event-bus';
import { orderV1, paymentV1 } from '@getir/proto';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { CallResult, TestGrpcServer } from '@getir/service-kit/testing';
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
import { createCancelPayment } from '../../../payment-service/src/application/cancel-payment.js';
import { createRefund } from '../../../payment-service/src/application/refund.js';
import { buildPaymentService } from '../../../payment-service/src/bootstrap.js';
import { InMemoryPaymentStore } from '../../../payment-service/src/infrastructure/memory/in-memory-payment-store.js';
import { createCancelRequestedHandler } from '../../../payment-service/src/interfaces/workers/cancel-requested.js';
import { createRefundRequestedHandler } from '../../../payment-service/src/interfaces/workers/refund-requested.js';
import { createRelayOutbox } from '../../src/application/relay-outbox.js';
import { createSweepExpiredReservations } from '../../src/application/sweep-expired-reservations.js';
import type { SweepRound } from '../../src/application/sweep-expired-reservations.js';
import { buildOrderService } from '../../src/bootstrap.js';
import { DEPENDENCY, dependencyResilience } from '../../src/infrastructure/grpc-resilience.js';
import { GrpcStockReservations } from '../../src/infrastructure/inventory/grpc-stock-reservations.js';
import { GrpcPayments } from '../../src/infrastructure/payment/grpc-payments.js';
import { FAKE_MARKET_ID, FakeCatalogPricing } from './fake-catalog-pricing.js';
import { TEST_CARD } from './fake-payments.js';
import { FakeRiskAssessment } from './fake-risk-assessment.js';
import { FUNCTIONAL_TIMEOUT_MS } from './held-replies.js';
import { cancelOrderRequest, createOrderRequest, draftRequest } from './order-fixtures.js';
import { FlakyPaidStore, PaymentFaults } from './qa-payment-faults.js';

export const MARKET = FAKE_MARKET_ID;
/** Taslak 2 x SUT-1L (order-fixtures.ts). */
export const SKU = 'SUT-1L';
export const DRAFT_QUANTITY = 2;
const ON_HAND = 100;
const LEVELS: readonly StockLevel[] = [{ marketId: MARKET, sku: SKU, onHand: ON_HAND }];
const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
/** Kilidin kesin dolmasi icin saat ilerletme: taslak 600 sn + odeme oncesi uzatmalar. */
export const PAST_LOCK_MS = 60 * 60 * 1_000;
const T0 = Date.parse('2026-10-07T12:00:00.000Z');
const orderService = orderV1.OrderServiceService;

export interface InventoryWorld {
  readonly clock: MutableClock;
  readonly stores: StockStores;
  address(): string;
  /** inventory'nin supurucusu bir tur (kilidi dolan rezervasyonun stogu doner). */
  sweepInventory(): Promise<void>;
}

/** Konteynerler, inventory deposu ve gRPC sunucusu: dosya basina bir kez. */
export function useInventoryWorld(dbName: string): InventoryWorld {
  const clock = fixedClock(T0);
  let mongo: StartedMongoDBContainer | undefined;
  let redis: StartedRedisContainer | undefined;
  let stores: StockStores | undefined;
  let source: StockSource | undefined;
  let server: TestGrpcServer | undefined;

  const storesEnv = (): StockStoresEnv => ({
    mongo: {
      uri: `${need(mongo, 'mongo').getConnectionString()}?directConnection=true`,
      dbName,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: 5_000,
    },
    redis: { REDIS_URL: need(redis, 'redis').getConnectionUrl(), REDIS_CONNECT_TIMEOUT_MS: 5_000 },
  });

  beforeAll(async () => {
    [mongo, redis] = await Promise.all([
      new MongoDBContainer(MONGO_IMAGE).start(),
      new RedisContainer(REDIS_IMAGE).start(),
    ]);
    stores = await openStockStores(storesEnv(), silentLogger, `qa-${dbName}`);
    await createSeedStock({
      writer: new MongoStockSeedWriter(stores.mongo, stores.repository, stores.ledger),
      levels: LEVELS,
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

/** Bir testin order + payment'i ve senaryo adimlari. */
export interface Shop {
  readonly faults: PaymentFaults;
  readonly payments: InMemoryPaymentStore;
  readonly orders: FlakyPaidStore;
  /** Her cagri yeni kullanici (B22 kullanici kilidi testler arasinda tasinmasin). */
  nextUser(): string;
  draft(userId: string): Promise<string>;
  createOrder(
    orderId: string,
    userId: string,
    cardToken?: string,
  ): Promise<CallResult<orderV1.CreateOrderResponse>>;
  confirm(
    orderId: string,
    userId: string,
    challengeId: string,
  ): Promise<CallResult<orderV1.ConfirmPaymentResponse>>;
  cancel(orderId: string, userId: string): Promise<CallResult<orderV1.CancelOrderResponse>>;
  /** order'in supurucusu bir tur. */
  sweepOrders(): Promise<SweepRound>;
  /** Outbox aktaricisi bir tur; payment komutlari (iade, iptal) tuketicilere verilir. */
  deliverPaymentCommands(): Promise<readonly { topic: string; outcome: EventOutcome }[]>;
}

let userCounter = 0;

/** order + payment HER TEST icin taze: `open()` testin icinde, acilanlar test sonunda kapanir. */
export function useShops(world: InventoryWorld): (options?: ShopOptions) => Promise<Shop> {
  const opened: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await closeAll(opened.splice(0));
  });
  return async (options = {}) => {
    const { shop, close } = await openShop(world, options);
    opened.push(close);
    return shop;
  };
}

async function openShop(
  world: InventoryWorld,
  options: ShopOptions,
): Promise<{ shop: Shop; close: () => Promise<void> }> {
  const faults = new PaymentFaults();
  const payments = new InMemoryPaymentStore();
  const orders = new FlakyPaidStore();
  const closers: (() => unknown)[] = [];
  const close = () => closeAll(closers.splice(0).reverse());
  try {
    const paymentServer = await startTestGrpcServer({
      serviceName: 'qa-payment',
      logger: silentLogger,
      services: [faults.wrap(buildPaymentService({ repository: payments, clock: world.clock }))],
    });
    closers.push(() => paymentServer.stop());
    const paymentClient = new GrpcPayments(
      `127.0.0.1:${paymentServer.handle.port}`,
      options.paymentTimeoutMs ?? FUNCTIONAL_TIMEOUT_MS,
      dependencyResilience(DEPENDENCY.PAYMENT, silentLogger),
    );
    closers.push(() => paymentClient.close());
    const stock = new GrpcStockReservations(
      world.address(),
      FUNCTIONAL_TIMEOUT_MS,
      dependencyResilience(DEPENDENCY.INVENTORY, silentLogger),
    );
    closers.push(() => stock.close());
    const orderServer = await startTestGrpcServer({
      serviceName: 'qa-order',
      logger: silentLogger,
      services: [
        buildOrderService({
          catalog: new FakeCatalogPricing(),
          risk: new FakeRiskAssessment(),
          payments: paymentClient,
          stock,
          clock: world.clock,
          store: { repository: orders, history: orders, outbox: orders },
        }),
      ],
    });
    closers.push(() => orderServer.stop());
    return {
      shop: shopOf({ world, faults, payments, orders, orderServer, paymentClient, stock }),
      close,
    };
  } catch (error: unknown) {
    await close();
    throw error;
  }
}

function shopOf(parts: {
  readonly world: InventoryWorld;
  readonly faults: PaymentFaults;
  readonly payments: InMemoryPaymentStore;
  readonly orders: FlakyPaidStore;
  readonly orderServer: TestGrpcServer;
  readonly paymentClient: GrpcPayments;
  readonly stock: GrpcStockReservations;
}): Shop {
  const { world, faults, payments, orders, orderServer } = parts;
  const sweep = createSweepExpiredReservations({
    expired: orders,
    repository: orders,
    payments: parts.paymentClient,
    stock: parts.stock,
    outbox: orders,
    clock: world.clock,
    batchSize: 10,
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
  const onRefund = createRefundRequestedHandler({
    refund: createRefund({ repository: payments, clock: world.clock }),
  });
  const onCancel = createCancelRequestedHandler({
    cancel: createCancelPayment({ repository: payments, clock: world.clock }),
  });
  return {
    faults,
    payments,
    orders,
    nextUser: () => {
      userCounter += 1;
      return `usr_${(0x12200 + userCounter).toString(16).padStart(32, '0')}`;
    },
    draft: async (userId) => {
      const { response, error } = await orderServer.call(orderService.createDraftOrder, {
        ...draftRequest,
        userId,
      });
      if (response === undefined) throw new Error(`taslak acilamadi: ${error?.message ?? ''}`);
      return response.orderId;
    },
    createOrder: (orderId, userId, cardToken = TEST_CARD.APPROVED) =>
      orderServer.call(
        orderService.createOrder,
        createOrderRequest(orderId, {
          userId,
          cardToken,
          paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
        }),
      ),
    confirm: (orderId, userId, challengeId) =>
      orderServer.call(orderService.confirmPayment, {
        orderId,
        userId,
        challengeId,
        code: MOCK_THREEDS_CODE,
        idempotencyKey: draftRequest.idempotencyKey,
      }),
    cancel: (orderId, userId) =>
      orderServer.call(orderService.cancelOrder, cancelOrderRequest(orderId, { userId })),
    sweepOrders: () => sweep(silentLogger),
    deliverPaymentCommands: async () => {
      delivered.length = 0;
      await relay(silentLogger);
      const outcomes: { topic: string; outcome: EventOutcome }[] = [];
      for (const envelope of delivered) {
        const handler =
          envelope.topic === EVENTS.PAYMENT_REFUND_REQUESTED
            ? onRefund
            : envelope.topic === EVENTS.PAYMENT_CANCEL_REQUESTED
              ? onCancel
              : undefined;
        if (handler === undefined) continue;
        outcomes.push({
          topic: envelope.topic,
          outcome: await handler(envelope, { attempt: 1, logger: silentLogger }),
        });
      }
      return outcomes;
    },
  };
}

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} henuz kurulmadi`);
  return value;
}

/** Hepsini kapatir; biri dusse de digerleri kapanir, ilk hata sonda firlar. */
async function closeAll(steps: readonly (() => unknown)[]): Promise<void> {
  let first: unknown;
  for (const step of steps) {
    try {
      await step();
    } catch (error: unknown) {
      first ??= error;
    }
  }
  if (first !== undefined) {
    throw first instanceof Error ? first : new Error('kapanis basarisiz', { cause: first });
  }
}
