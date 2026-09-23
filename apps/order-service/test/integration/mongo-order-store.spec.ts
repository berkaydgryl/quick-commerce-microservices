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
import { orderV1 } from '@getir/proto';
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
      services: [buildOrderService({ store: { repository: store, history: store } })],
    });
    client = new Client(`127.0.0.1:${handle.port}`, credentials.createInsecure());
  });

  afterAll(async () => {
    client?.close();
    await handle?.shutdown('test bitti');
  });

  it('taslak -> siparis: belge orders koleksiyonunda, zaman cizelgesi ve surumuyle', async () => {
    const draft = await call(orderV1.OrderServiceService.createDraftOrder, {
      userId: 'usr_grpc',
      darkStoreId: '',
      marketId: 'mkt_a101-caferaga',
      lines: [{ productId: 'prd_sut-1l', sku: 'SUT-1L', quantity: 2 }],
      deliveryLocation: { lat: 40.9885, lng: 29.0262 },
      deliveryAddress: 'Caferağa, Kadıköy',
      idempotencyKey: '4f1c3a2b-9d8e-11ee',
    });
    const orderId = draft.response?.orderId ?? '';
    await call(orderV1.OrderServiceService.createOrder, {
      orderId,
      userId: 'usr_grpc',
      paymentMethod: 0,
      cardToken: '',
      idempotencyKey: '4f1c3a2b-9d8e-11ef',
    });

    const document = await connection.db
      .collection(COLLECTIONS.ORDERS)
      .findOne({ _id: orderId } as Document);

    expect(document).toMatchObject({
      userId: 'usr_grpc',
      marketId: 'mkt_a101-caferaga',
      status: 'AWAITING_PAYMENT',
      version: 4,
      lines: [{ productId: 'prd_sut-1l', sku: 'SUT-1L', quantity: 2 }],
    });
    expect(document?.['timeline']).toMatchObject([
      { status: 'DRAFT' },
      { status: 'RISK_CHECK', note: 'PENDING_RISK_SERVICE' },
      { status: 'RESERVED', note: 'PENDING_RESERVATION' },
      { status: 'AWAITING_PAYMENT' },
    ]);

    // Ayni kayit GetOrder ve ListMyOrders ile de okunur (servis yeniden baslasa da).
    const got = await call(orderV1.OrderServiceService.getOrder, { orderId, userId: 'usr_grpc' });
    const listed = await call(orderV1.OrderServiceService.listMyOrders, { userId: 'usr_grpc' });
    expect(got.response?.order?.status).toBe(orderV1.OrderStatus.ORDER_STATUS_AWAITING_PAYMENT);
    expect(listed.response?.orders.map((order) => order.id)).toEqual([orderId]);
  });
});
