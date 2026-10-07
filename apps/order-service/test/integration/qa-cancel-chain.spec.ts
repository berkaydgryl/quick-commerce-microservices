/**
 * QA kara kutu (T15.2 geriye donuk tur, inventory PR 2; IQ4): IPTAL ZINCIRI uctan uca. order'in
 * GERCEK gRPC sunucusu (CreateDraftOrder, CreateOrder, CancelOrder), GERCEK stok istemcisi
 * (GrpcStockReservations, uretimdeki dayaniklilik; sure islevsel 2 sn, #113) ve GERCEK
 * inventory (Redis + Mongo, ortak sabit saat). catalog, risk ve payment sahtedir (bu zincirin
 * disinda).
 *
 *   Taslak iptali: stok ve kullanici kilidi doner; defterde TEK release, gerekce cart_released
 *     (T11.4). Odeme bekleyen iptal user_cancelled.
 *   Gateway'in "released:false" cevabi (DELETE /v1/cart/reserve) order'in su sozlesmesine dayanir:
 *     ikinci iptal ORDER_STATE_INVALID ve ayrintida status CANCELLED; stok ikinci kez donmez.
 *   Baskasinin siparisi NOT_FOUND; odenmis siparis ORDER_STATE_INVALID (409); parasi alinmis odeme
 *     bekleyen siparis REQUEST_IN_PROGRESS. Ucunde de kilit ve stok yerinde kalir.
 *   Taslagin bitisi inventory'deki bitisle AYNI (indeks puani).
 *   Bulgu (#126): Reserve inventory'de uygulanir ama cevabi order'in sure sinirindan sonra gelirse
 *     taslak yazilmaz, kilit KAYDI OLMAYAN siparis adina kalir; kullanicinin yeni sepeti kilit
 *     omru boyunca RESERVATION_ACTIVE alir (MEVCUT davranis belgelenir).
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS, silentLogger } from '@getir/core';
import { orderV1, paymentV1 } from '@getir/proto';
import { reservationIndexKey, stockAvailKey, userReservationKey } from '@getir/redis-kit';
import type { GrpcServiceRegistration } from '@getir/service-kit';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import type { handleUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSeedStock } from '../../../inventory-service/src/application/seed-stock.js';
import { buildInventoryService } from '../../../inventory-service/src/bootstrap.js';
import type { StockStoresEnv } from '../../../inventory-service/src/config/env.js';
import type { StockLevel } from '../../../inventory-service/src/domain/stock.js';
import { LEDGER_KINDS } from '../../../inventory-service/src/domain/stock-ledger.js';
import { COLLECTIONS } from '../../../inventory-service/src/infrastructure/mongo/documents.js';
import type {
  StockDocument,
  StockLedgerDocument,
} from '../../../inventory-service/src/infrastructure/mongo/documents.js';
import { MongoStockSeedWriter } from '../../../inventory-service/src/infrastructure/mongo/mongo-stock-seed-writer.js';
import type { StockSource } from '../../../inventory-service/src/infrastructure/stock-source.js';
import { openStockSource } from '../../../inventory-service/src/infrastructure/stock-source.js';
import type { StockStores } from '../../../inventory-service/src/infrastructure/stock-stores.js';
import { openStockStores } from '../../../inventory-service/src/infrastructure/stock-stores.js';
import { buildOrderService } from '../../src/bootstrap.js';
import { DEFAULT_RESERVATION_TTL_SECONDS } from '../../src/config/constants.js';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../src/domain/checkout-payment.js';
import { RELEASE_REASON } from '../../src/domain/stock-reservation.js';
import { DEPENDENCY, dependencyResilience } from '../../src/infrastructure/grpc-resilience.js';
import { GrpcStockReservations } from '../../src/infrastructure/inventory/grpc-stock-reservations.js';
import { FAKE_MARKET_ID, FakeCatalogPricing } from '../support/fake-catalog-pricing.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeRiskAssessment } from '../support/fake-risk-assessment.js';
import { FUNCTIONAL_TIMEOUT_MS } from '../support/held-replies.js';
import { cancelOrderRequest, createOrderRequest, draftRequest } from '../support/order-fixtures.js';

const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const DB_NAME = 'qa_inventory_iptal_zinciri';
const MARKET = FAKE_MARKET_ID;
/** Taslak 2 x SUT-1L (order-fixtures.ts); stok genis: testler birbirini tuketmesin. */
const SKU = 'SUT-1L';
const DRAFT_QUANTITY = 2;
const ON_HAND = 100;
const LEVELS: readonly StockLevel[] = [{ marketId: MARKET, sku: SKU, onHand: ON_HAND }];
const MS_PER_SECOND = 1_000;
const T0 = Date.parse('2026-10-07T10:00:00.000Z');
const clock = fixedClock(T0);
/** Gec cevap: order'in tek sure siniri dolsun (cagri icinde tekrar firsati kalmaz). */
const SLOW_REPLY_MS = FUNCTIONAL_TIMEOUT_MS + 500;
const orders = orderV1.OrderServiceService;
const S = orderV1.OrderStatus;

let mongoContainer: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
let stores: StockStores;
let source: StockSource;
let inventoryServer: TestGrpcServer;
let orderServer: TestGrpcServer;
let stock: GrpcStockReservations;
const payments = new FakePayments();
let userCounter = 0;

/** Siradaki Reserve inventory'de UYGULANIR, cevabi order'in sure sinirindan sonra gelir. */
class SlowNextReserve {
  private armed = false;

  arm(): void {
    this.armed = true;
  }

  wrap(registration: GrpcServiceRegistration): GrpcServiceRegistration {
    const original = registration.implementation['reserve'] as handleUnaryCall<unknown, unknown>;
    const reserve: handleUnaryCall<unknown, unknown> = (call, callback) => {
      original(call, (...reply: Parameters<sendUnaryData<unknown>>) => {
        if (!this.armed) {
          callback(...reply);
          return;
        }
        this.armed = false;
        setTimeout(() => callback(...reply), SLOW_REPLY_MS);
      });
    };
    return { ...registration, implementation: { ...registration.implementation, reserve } };
  }
}
const slowReserve = new SlowNextReserve();

function storesEnv(): StockStoresEnv {
  return {
    mongo: {
      uri: `${mongoContainer.getConnectionString()}?directConnection=true`,
      dbName: DB_NAME,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: 5_000,
    },
    redis: { REDIS_URL: redisContainer.getConnectionUrl(), REDIS_CONNECT_TIMEOUT_MS: 5_000 },
  };
}

beforeAll(async () => {
  [mongoContainer, redisContainer] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  stores = await openStockStores(storesEnv(), silentLogger, 'qa-iptal-zinciri');
  await createSeedStock({
    writer: new MongoStockSeedWriter(stores.mongo, stores.repository, stores.ledger),
    levels: LEVELS,
    isProduction: false,
  })();
  source = await openStockSource(storesEnv(), silentLogger);
  inventoryServer = await startTestGrpcServer({
    serviceName: 'qa-inventory',
    logger: silentLogger,
    services: [slowReserve.wrap(buildInventoryService({ stock: source, clock }))],
  });
  stock = new GrpcStockReservations(
    `127.0.0.1:${inventoryServer.handle.port}`,
    // Islevsel sure (#113): uretimdeki 1 sn yuklu CI'da soguk kanal ve Mongo islemiyle asilabilir.
    FUNCTIONAL_TIMEOUT_MS,
    dependencyResilience(DEPENDENCY.INVENTORY, silentLogger),
  );
  orderServer = await startTestGrpcServer({
    serviceName: 'qa-order',
    logger: silentLogger,
    services: [
      buildOrderService({
        catalog: new FakeCatalogPricing(),
        risk: new FakeRiskAssessment(),
        payments,
        stock,
        clock,
      }),
    ],
  });
}, 120_000);

afterAll(async () => {
  await orderServer?.stop();
  stock?.close();
  await inventoryServer?.stop();
  await source?.close();
  await stores?.close();
  await Promise.all([mongoContainer?.stop(), redisContainer?.stop()]);
});

/** Her test kendi kullanicisi: B22 kullanici kilidi testler arasinda tasinmasin. */
function nextUser(): string {
  userCounter += 1;
  return `usr_${(0x1c4 + userCounter).toString(16).padStart(32, '0')}`;
}

async function draftFor(userId: string): Promise<orderV1.CreateDraftOrderResponse> {
  const { response, error } = await orderServer.call(orders.createDraftOrder, {
    ...draftRequest,
    userId,
  });
  if (response === undefined) throw new Error(`taslak acilamadi: ${error?.message ?? ''}`);
  return response;
}

function cancel(orderId: string, userId: string, reason = '') {
  return orderServer.call(orders.cancelOrder, cancelOrderRequest(orderId, { userId, reason }));
}

/** Sayac; anahtar yoksa test duser (eksik sayac 0 sanilmasin). */
async function counter(): Promise<number> {
  const raw = await stores.redis.redis.get(stockAvailKey(MARKET, SKU));
  if (raw === null) throw new Error('sayac anahtari yok');
  return Number(raw);
}

/** Eldeki adet; belge yoksa test duser (NaN === NaN yanlis yesil vermesin). */
async function onHand(): Promise<number> {
  const document = await stores.mongo.db
    .collection<StockDocument>(COLLECTIONS.STOCK)
    .findOne({ marketId: MARKET, sku: SKU });
  if (document === null) throw new Error('stok belgesi yok');
  return document.onHand;
}

function ledger(orderId: string): Promise<StockLedgerDocument[]> {
  return stores.mongo.db
    .collection<StockLedgerDocument>(COLLECTIONS.STOCK_LEDGER)
    .find({ marketId: MARKET, orderId })
    .toArray();
}

function userLock(userId: string): Promise<string | null> {
  return stores.redis.redis.get(userReservationKey(userId));
}

/** Sipariste kilit ve stok yerinde: sayac taslak kadar dusuk, kullanici kilidi bu sipariste. */
async function expectStillLocked(orderId: string, userId: string, before: number): Promise<void> {
  expect(await counter()).toBe(before - DRAFT_QUANTITY);
  expect(await userLock(userId)).toBe(orderId);
  expect((await ledger(orderId)).filter((entry) => entry.kind === LEDGER_KINDS.RELEASE)).toEqual(
    [],
  );
}

describe('QA IQ4 iptal zinciri: order CancelOrder -> inventory Release', () => {
  it('taslak iptali: CANCELLED; stok ve kullanici kilidi doner; defterde TEK release, cart_released', async () => {
    const userId = nextUser();
    const before = await counter();
    const draft = await draftFor(userId);
    // Olumlu denetim: kilit ve dusum gercekten vardi (bos anahtar "yok" sanilmasin).
    await expectStillLocked(draft.orderId, userId, before);

    const { response, error } = await cancel(draft.orderId, userId);

    expect(error).toBeUndefined();
    expect(response?.status).toBe(S.ORDER_STATUS_CANCELLED);
    expect(await counter()).toBe(before);
    expect(await userLock(userId)).toBeNull();
    const releases = (await ledger(draft.orderId)).filter(
      (entry) => entry.kind === LEDGER_KINDS.RELEASE,
    );
    expect(releases).toEqual([
      expect.objectContaining({
        sku: SKU,
        quantity: DRAFT_QUANTITY,
        // Birakma eldeki adedi (onHand) degistirmez; yalnizca sayac doner.
        delta: 0,
        reason: RELEASE_REASON.CART_RELEASED,
      }),
    ]);
    // Kilit gercekten birakildi: ayni kullanici hemen yeni sepet kilitler.
    const next = await draftFor(userId);
    expect(next.status).toBe(S.ORDER_STATUS_DRAFT);
    await cancel(next.orderId, userId);
  });

  it('ikinci iptal: ORDER_STATE_INVALID, ayrintida status CANCELLED (gateway released:false); stok ikinci kez donmez', async () => {
    const userId = nextUser();
    const before = await counter();
    const draft = await draftFor(userId);
    await cancel(draft.orderId, userId);

    const { error } = await cancel(draft.orderId, userId);

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
      details: { orderId: draft.orderId, status: 'CANCELLED' },
    });
    expect(await counter()).toBe(before);
    expect(
      (await ledger(draft.orderId)).filter((entry) => entry.kind === LEDGER_KINDS.RELEASE),
    ).toHaveLength(1);
  });

  it('baskasinin siparisi: NOT_FOUND (var oldugu sizmaz); kilit ve stok yerinde, sahibi iptal edebilir', async () => {
    const owner = nextUser();
    const stranger = nextUser();
    const before = await counter();
    const draft = await draftFor(owner);

    const { error } = await cancel(draft.orderId, stranger);

    expect(error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.NOT_FOUND);
    await expectStillLocked(draft.orderId, owner, before);
    expect((await cancel(draft.orderId, owner)).error).toBeUndefined();
    expect(await counter()).toBe(before);
  });

  it('odeme bekleyen (3DS) siparis iptali: gerekce user_cancelled; stok doner', async () => {
    const userId = nextUser();
    const before = await counter();
    const draft = await draftFor(userId);
    const created = await orderServer.call(
      orders.createOrder,
      createOrderRequest(draft.orderId, { userId, cardToken: TEST_CARD.CHALLENGE }),
    );
    expect(created.response?.status).toBe(S.ORDER_STATUS_AWAITING_PAYMENT);

    const { error } = await cancel(draft.orderId, userId);

    expect(error).toBeUndefined();
    expect(await counter()).toBe(before);
    expect(await userLock(userId)).toBeNull();
    expect(
      (await ledger(draft.orderId))
        .filter((entry) => entry.kind === LEDGER_KINDS.RELEASE)
        .map((entry) => entry.reason),
    ).toEqual([RELEASE_REASON.USER_CANCELLED]);
  });

  it('parasi alinmis odeme bekleyen siparis: REQUEST_IN_PROGRESS; kilit birakilmaz', async () => {
    const userId = nextUser();
    const before = await counter();
    const draft = await draftFor(userId);
    await orderServer.call(
      orders.createOrder,
      createOrderRequest(draft.orderId, { userId, cardToken: TEST_CARD.CHALLENGE }),
    );
    // payment-svc'de para alinmis (3DS onayinin cevabi order'a ulasmadi).
    payments.payments.set(draft.orderId, {
      status: PAYMENT_STATUS.SUCCEEDED,
      method: PAYMENT_METHOD.CARD,
    });

    const { error } = await cancel(draft.orderId, userId);

    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.REQUEST_IN_PROGRESS);
    await expectStillLocked(draft.orderId, userId, before);
  });

  it('odenmis siparis: ORDER_STATE_INVALID (409); stok kesin dusmus, defterde commit, release yok', async () => {
    const userId = nextUser();
    const before = await counter();
    const onHandBefore = await onHand();
    const draft = await draftFor(userId);
    const paid = await orderServer.call(
      orders.createOrder,
      createOrderRequest(draft.orderId, {
        userId,
        cardToken: TEST_CARD.APPROVED,
        paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
      }),
    );
    expect(paid.response?.status).toBe(S.ORDER_STATUS_PAID);

    const { error } = await cancel(draft.orderId, userId);

    expect(error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
    expect(appErrorOf(error)).toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
      details: { status: 'PAID' },
    });
    expect(await counter()).toBe(before - DRAFT_QUANTITY);
    expect(await onHand()).toBe(onHandBefore - DRAFT_QUANTITY);
    // Odeme oncesi uzatma (T11.3) defterde extend birakabilir; sonuc commit, release YOK.
    const kinds = (await ledger(draft.orderId)).map((entry) => entry.kind);
    expect(kinds.filter((kind) => kind === LEDGER_KINDS.COMMIT)).toHaveLength(1);
    expect(kinds).not.toContain(LEDGER_KINDS.RELEASE);
  });

  it('taslagin bitisi inventory ile AYNI: cevap = indeks puani = simdi + kilit suresi', async () => {
    const userId = nextUser();
    const draft = await draftFor(userId);

    const expected = clock.now() + DEFAULT_RESERVATION_TTL_SECONDS * MS_PER_SECOND;
    expect(draft.reservationExpiresAt?.getTime()).toBe(expected);
    const score = await stores.redis.redis.zscore(reservationIndexKey(MARKET), draft.orderId);
    expect(Number(score)).toBe(expected);
    await cancel(draft.orderId, userId);
  });
});

// #126: duzeltmeyle TERSINE donecek (telafi Release + kaydi olmayan eski kilidin birakilmasi): yeni
// sepet kilitlenir, yetim kilit kalmaz.
describe('QA IQ4 bulgu (#126): gec gelen Reserve cevabi kaydi olmayan kilit birakir', () => {
  it("MEVCUT davranis: ilk sepet SERVICE_UNAVAILABLE ama kilit inventory'de; yeni sepet RESERVATION_ACTIVE", async () => {
    const userId = nextUser();
    const before = await counter();
    slowReserve.arm();

    const first = await orderServer.call(orders.createDraftOrder, { ...draftRequest, userId });

    expect(appErrorOf(first.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    // inventory uyguladi: stok dustu, kullanici kilidi order'in BILMEDIGI siparis adina.
    const orphanId = await userLock(userId);
    expect(orphanId).toMatch(/^ord_/);
    expect(await counter()).toBe(before - DRAFT_QUANTITY);
    const lookup = await orderServer.call(orders.getOrder, { orderId: orphanId ?? '', userId });
    expect(appErrorOf(lookup.error)?.code).toBe(ERROR_CODES.NOT_FOUND);

    // Kullanici tekrar dener: onceki kilidin siparisi yok, order onu birakamaz.
    const second = await orderServer.call(orders.createDraftOrder, { ...draftRequest, userId });

    expect(second.error?.code).toBe(GRPC_STATUS.ALREADY_EXISTS);
    expect(appErrorOf(second.error)).toMatchObject({
      code: ERROR_CODES.RESERVATION_ACTIVE,
      details: { activeOrderId: orphanId },
    });
    expect(await counter()).toBe(before - DRAFT_QUANTITY);

    // Temizlik: yetim kilit elle birakilir (sonraki testlerin sayaci).
    await stock.release(
      { orderId: orphanId ?? '', marketId: MARKET, reason: RELEASE_REASON.STALE_LOCK },
      { requestId: 'req_qa_yetim_kilit', logger: silentLogger },
    );
    expect(await counter()).toBe(before);
  });
});
