/**
 * Siparis deposunun Mongo uygulamasi - gercek Mongo (Testcontainers).
 *
 * Sahte istemciyle dogrulanamayan seyler burada sinanir:
 *   1. Sozlesme testleri: bellek uygulamasiyla AYNI senaryolar gercek sorguda
 *      (surum kosullu replaceOne, _id tekil ihlali, imlec filtresi).
 *   2. Indeks: ListMyOrders sorgusu bellekte SIRALAMA yapmadan indeksten okur;
 *      kurye iscisinin talep ve bekleyen (#92) sorgulari kismi indekslerinden.
 *   3. T4.5 "bitti sayilir": gRPC ile acilan siparis `orders` koleksiyonunda gorulur.
 */

import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { orderV1, paymentV1 } from '@getir/proto';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer, UnaryCall } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildOrderService } from '../../src/bootstrap.js';
import { DEFAULT_RESERVATION_TTL_SECONDS } from '../../src/config/constants.js';
import { FakeCatalogPricing } from '../support/fake-catalog-pricing.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeStockReservations } from '../support/fake-stock-reservations.js';
import { FakeRiskAssessment } from '../support/fake-risk-assessment.js';
import { DRAFT_TOTAL_MINOR, draftRequest } from '../support/order-fixtures.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MongoOrderOutbox } from '../../src/infrastructure/mongo/mongo-order-outbox.js';
import { OrderMongoStore } from '../../src/infrastructure/mongo/order-mongo-store.js';
import { OrdersCollection } from '../../src/infrastructure/mongo/orders-collection.js';
import { OutboxCollection } from '../../src/infrastructure/mongo/outbox-collection.js';
import { describeOrderStoreContract } from '../support/order-store-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_order_test';

const explainSchema = z.object({ queryPlanner: z.object({ winningPlan: z.unknown() }) });
const statsSchema = explainSchema.extend({
  executionStats: z.object({ nReturned: z.number(), totalKeysExamined: z.number() }),
});

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let store: OrderMongoStore;
let outbox: MongoOrderOutbox;

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    // Uretimdeki gibi sureli (#51): toplu yazim ve transaction bu ayarla kosar.
    operationTimeoutMs: 2_000,
  });
  const orders = new OrdersCollection(connection.db);
  const outboxCollection = new OutboxCollection(connection.db);
  await orders.ensureIndexes();
  await outboxCollection.ensureIndexes();
  store = new OrderMongoStore(orders, outboxCollection, connection);
  outbox = new MongoOrderOutbox(outboxCollection);
});

afterAll(async () => {
  await connection.close();
  await container.stop();
});

describeOrderStoreContract('mongo', () => store);
// Outbox'in Mongo sozlesmesi, es zamanlilik ve indeks plani: test/integration/outbox.spec.ts.

describe('indeks', () => {
  it('gecmis sorgusu indeksten sirali okunur, bellekte SORT asamasi yok', async () => {
    const plan: Document = await connection.db
      .collection(COLLECTIONS.ORDERS)
      .find({ userId: 'usr_plan' })
      .sort({ createdAt: -1, _id: -1 })
      .explain('queryPlanner');

    // explain ciktisi suruceden gelen serbest bicimli belge: semadan gecirilir.
    const { queryPlanner } = explainSchema.parse(plan);
    const winning = JSON.stringify(queryPlanner.winningPlan);
    expect(winning).toContain('userId_createdAt_id');
    expect(winning).not.toContain('"stage":"SORT"');
  });

  it('supurucu sorgusu (T11.2 PR 2) durum + kilit bitisi indeksinden, bellekte SORT yok', async () => {
    // orders-collection.ts findExpiredReservations ile ayni sorgu ve sira.
    const plan: Document = await connection.db
      .collection(COLLECTIONS.ORDERS)
      .find({
        status: { $in: ['DRAFT', 'AWAITING_PAYMENT'] },
        'reservation.expiresAt': { $lte: new Date() },
      })
      .sort({ 'reservation.expiresAt': 1, _id: 1 })
      .limit(100)
      .explain('queryPlanner');

    const { queryPlanner } = explainSchema.parse(plan);
    const winning = JSON.stringify(queryPlanner.winningPlan);
    expect(winning).toContain('status_reservationExpiresAt_id');
    expect(winning).not.toContain('"stage":"SORT"');
    expect(winning).not.toContain('COLLSCAN');
  });

  it('kurye iscisinin indeksi (T13.1 PR 2) KISMI: yalnizca PAID ve PREPARING girer', async () => {
    const indexes = await connection.db.collection(COLLECTIONS.ORDERS).indexes();

    expect(indexes.find((index) => index.name === 'status_courierRetryAt_id')).toMatchObject({
      key: { status: 1, courierRetryAt: 1, _id: 1 },
      partialFilterExpression: { status: { $in: ['PAID', 'PREPARING'] } },
    });
  });

  it('kurye iscisinin sorgusu iki kolu da kismi indeksten okur, SORT_MERGE ile birlestirir; bellekte SORT yok', async () => {
    // orders-collection.ts findAwaitingCourier ile ayni sorgu ve sira.
    const plan: Document = await connection.db
      .collection(COLLECTIONS.ORDERS)
      .find({
        $or: [
          { status: 'PAID' },
          {
            status: 'PREPARING',
            courier: { $exists: false },
            courierRetryAt: { $lte: new Date() },
          },
        ],
      })
      .sort({ courierRetryAt: 1, _id: 1 })
      .limit(100)
      .explain('queryPlanner');

    const { queryPlanner } = explainSchema.parse(plan);
    const winning = JSON.stringify(queryPlanner.winningPlan);
    expect(winning).toContain('SORT_MERGE');
    expect(winning.match(/status_courierRetryAt_id/g)).toHaveLength(2);
    expect(winning).not.toContain('"stage":"SORT"');
    expect(winning).not.toContain('COLLSCAN');
  });

  it('kurye kuyrugu indeksi (#92) KISMI: yalnizca kuryesiz bekleyen PREPARING (deneme ani olan) girer', async () => {
    const indexes = await connection.db.collection(COLLECTIONS.ORDERS).indexes();

    expect(indexes.find((index) => index.name === 'status_courierQueuedAt_id')).toMatchObject({
      key: { status: 1, courierQueuedAt: 1, _id: 1 },
      partialFilterExpression: { status: 'PREPARING', courierRetryAt: { $exists: true } },
    });
  });

  it('bekleyen sorgusu (#92) kuyruk indeksinden SIRALI okunur: bellekte SORT yok, okunan anahtar donen kadar', async () => {
    // orders-collection.ts findWaitingBefore ile ayni sorgu ve sira. Sozlesme
    // testlerinin bekleyenleri koleksiyonda: okunan her anahtar donmeli.
    const plan: Document = await connection.db
      .collection(COLLECTIONS.ORDERS)
      .find({
        status: 'PREPARING',
        courierRetryAt: { $exists: true },
        courier: { $exists: false },
        courierQueuedAt: { $lt: new Date('2100-01-01T00:00:00.000Z') },
      })
      .sort({ courierQueuedAt: 1, _id: 1 })
      .limit(100)
      .explain('executionStats');

    const { queryPlanner, executionStats } = statsSchema.parse(plan);
    const winning = JSON.stringify(queryPlanner.winningPlan);
    expect(winning).toContain('status_courierQueuedAt_id');
    expect(winning).not.toContain('"stage":"SORT"');
    expect(winning).not.toContain('COLLSCAN');
    expect(executionStats.nReturned).toBeGreaterThan(0);
    expect(executionStats.totalKeysExamined).toBeLessThanOrEqual(executionStats.nReturned + 1);
  });
});

describe('gRPC -> Mongo (T4.5 bitti sayilir: siparis Mongo da gorulur)', () => {
  let server: TestGrpcServer | undefined;

  const call: UnaryCall = (method, request, metadata) =>
    server === undefined
      ? Promise.reject(new Error('test sunucusu henuz baslamadi'))
      : server.call(method, request, metadata);

  beforeAll(async () => {
    server = await startTestGrpcServer({
      serviceName: 'order-int-test',
      services: [
        buildOrderService({
          store: { repository: store, history: store, outbox },
          catalog: new FakeCatalogPricing(),
          risk: new FakeRiskAssessment(),
          payments: new FakePayments(),
          stock: new FakeStockReservations(),
        }),
      ],
    });
  });

  afterAll(async () => {
    await server?.stop();
  });

  it('taslak -> odenmis siparis (saga, T7.1): belge orders koleksiyonunda, zaman cizelgesi, bant ve surumuyle', async () => {
    const draft = await call(orderV1.OrderServiceService.createDraftOrder, {
      ...draftRequest,
      userId: 'usr_grpc',
    });
    const orderId = draft.response?.orderId ?? '';
    await call(orderV1.OrderServiceService.createOrder, {
      orderId,
      userId: 'usr_grpc',
      paymentMethod: paymentV1.PaymentMethod.PAYMENT_METHOD_CARD,
      cardToken: TEST_CARD.APPROVED,
      cardId: '',
      idempotencyKey: '4f1c3a2b-9d8e-11ef',
    });

    const document = await connection.db
      .collection(COLLECTIONS.ORDERS)
      .findOne({ _id: orderId } as Document);

    // Fiyat taslakta dondurulur (T7.2); CreateOrder tutari degistirmez.
    expect(document).toMatchObject({
      userId: 'usr_grpc',
      marketId: 'mkt_migros-jet-moda',
      status: 'PAID',
      riskBand: 'LOW',
      version: 5,
      items: [
        {
          productId: 'prd_01',
          sku: 'SUT-1L',
          name: 'Süt 1 L',
          unit: 'LITER',
          quantity: 2,
          unitPriceMinor: 3_250,
          lineTotalMinor: 6_500,
        },
      ],
      pricing: {
        currency: 'TRY',
        subtotalMinor: 6_500,
        deliveryFeeMinor: 1_490,
        discountMinor: 0,
        totalMinor: DRAFT_TOTAL_MINOR,
      },
    });
    expect(document?.['pricing']).not.toHaveProperty('couponCode');
    // Hicbir adimda not yok (strict): RESERVED artik PENDING_RESERVATION yazmaz (T11.2).
    const timeline = z
      .array(z.object({ status: z.string(), at: z.date() }).strict())
      .parse(document?.['timeline']);
    expect(timeline.map((entry) => entry.status)).toEqual([
      'DRAFT',
      'RISK_CHECK',
      'RESERVED',
      'AWAITING_PAYMENT',
      'PAID',
    ]);
    // Stok kilidi taslakla ayni belgede (T11.2); PAID'de de iz olarak durur.
    // Omur: bitis ani inventory'nin (kilit aninda), baslangic order'in saati.
    const reservation = z
      .object({ reservedAt: z.date(), expiresAt: z.date() })
      .strict()
      .parse(document?.['reservation']);
    const lifetimeMs = reservation.expiresAt.getTime() - reservation.reservedAt.getTime();
    expect(lifetimeMs).toBeLessThanOrEqual(DEFAULT_RESERVATION_TTL_SECONDS * 1000);
    expect(lifetimeMs).toBeGreaterThan(DEFAULT_RESERVATION_TTL_SECONDS * 1000 - 5_000);

    // Ayni kayit GetOrder ve ListMyOrders ile de okunur (servis yeniden baslasa da).
    const got = await call(orderV1.OrderServiceService.getOrder, { orderId, userId: 'usr_grpc' });
    const listed = await call(orderV1.OrderServiceService.listMyOrders, { userId: 'usr_grpc' });
    expect(got.response?.order?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAID);
    expect(listed.response?.orders.map((order) => order.id)).toEqual([orderId]);
  });
});
