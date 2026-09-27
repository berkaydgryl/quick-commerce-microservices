/**
 * Siparis deposunun Mongo uygulamasi - gercek Mongo (Testcontainers).
 *
 * Sahte istemciyle dogrulanamayan seyler burada sinanir:
 *   1. Sozlesme testleri: bellek uygulamasiyla AYNI senaryolar gercek sorguda
 *      (surum kosullu replaceOne, _id tekil ihlali, imlec filtresi).
 *   2. Indeks: ListMyOrders sorgusu bellekte SIRALAMA yapmadan indeksten okur.
 *   3. T4.5 "bitti sayilir": gRPC ile acilan siparis `orders` koleksiyonunda gorulur.
 */

import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { orderV1, paymentV1 } from '@getir/proto';
import { startGrpcServer } from '@getir/service-kit';
import type { GrpcServerHandle } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition, ServiceError } from '@grpc/grpc-js';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildOrderService } from '../../src/bootstrap.js';
import { FakeCatalogPricing } from '../support/fake-catalog-pricing.js';
import { FakePayments, TEST_CARD } from '../support/fake-payments.js';
import { FakeRiskAssessment } from '../support/fake-risk-assessment.js';
import { DRAFT_TOTAL_MINOR, draftRequest } from '../support/order-fixtures.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { OrderMongoStore } from '../../src/infrastructure/mongo/order-mongo-store.js';
import { OrdersCollection } from '../../src/infrastructure/mongo/orders-collection.js';
import { describeOrderStoreContract } from '../support/order-store-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_order_test';
const EPHEMERAL_PORT = 0;

const explainSchema = z.object({ queryPlanner: z.object({ winningPlan: z.unknown() }) });

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let store: OrderMongoStore;

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
  });
  const orders = new OrdersCollection(connection.db);
  await orders.ensureIndexes();
  store = new OrderMongoStore(orders);
});

afterAll(async () => {
  await connection.close();
  await container.stop();
});

describeOrderStoreContract('mongo', () => store);

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
});

describe('gRPC -> Mongo (T4.5 bitti sayilir: siparis Mongo da gorulur)', () => {
  let handle: GrpcServerHandle;
  let client: Client;

  function call<TRequest, TResponse>(
    method: MethodDefinition<TRequest, TResponse>,
    request: TRequest,
  ): Promise<{ error: ServiceError | undefined; response: TResponse | undefined }> {
    return new Promise((resolve) => {
      client.makeUnaryRequest(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        request,
        new Metadata(),
        (error, response) => {
          resolve({ error: error ?? undefined, response: response ?? undefined });
        },
      );
    });
  }

  beforeAll(async () => {
    handle = await startGrpcServer({
      serviceName: 'order-int-test',
      host: '127.0.0.1',
      port: EPHEMERAL_PORT,
      services: [
        buildOrderService({
          store: { repository: store, history: store },
          catalog: new FakeCatalogPricing(),
          risk: new FakeRiskAssessment(),
          payments: new FakePayments(),
        }),
      ],
    });
    client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
  });

  afterAll(async () => {
    client?.close();
    await handle?.shutdown('test bitti');
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
    expect(document?.['timeline']).toMatchObject([
      { status: 'DRAFT' },
      { status: 'RISK_CHECK' },
      { status: 'RESERVED', note: 'PENDING_RESERVATION' },
      { status: 'AWAITING_PAYMENT' },
      { status: 'PAID' },
    ]);

    // Ayni kayit GetOrder ve ListMyOrders ile de okunur (servis yeniden baslasa da).
    const got = await call(orderV1.OrderServiceService.getOrder, { orderId, userId: 'usr_grpc' });
    const listed = await call(orderV1.OrderServiceService.listMyOrders, { userId: 'usr_grpc' });
    expect(got.response?.order?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_PAID);
    expect(listed.response?.orders.map((order) => order.id)).toEqual([orderId]);
  });
});
