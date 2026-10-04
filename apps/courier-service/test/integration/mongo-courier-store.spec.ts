/**
 * couriers'in Mongo uygulamasi - gercek Mongo (Testcontainers).
 *   1. Sozlesme: bellek deposuyla AYNI senaryolar gercek sorguda.
 *   2. Indeksler: atama sorgusu indeksten okunur; currentOrderId benzersiz ve kismi.
 *   3. B7: tek bos kurye, eszamanli siparisler -> biri atanir, digerleri NOT_FOUND.
 *   4. Tekrar: ayni siparis eszamanli istense de tek kurye baglanir.
 *   5. Acilis (gocler + indeksler) ve seed (transaction, tekrar kosunca sifirlar).
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS, ID_PREFIX, newId } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { courierV1 } from '@getir/proto';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { silentLogger } from '@getir/core';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSeedCouriers } from '../../src/application/seed-couriers.js';
import { buildCourierService } from '../../src/bootstrap.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Courier } from '../../src/domain/courier.js';
import { openCourierStore } from '../../src/infrastructure/courier-store.js';
import { COURIER_SEEDS } from '../../src/infrastructure/fixtures/couriers.js';
import { CourierMongoStore } from '../../src/infrastructure/mongo/courier-mongo-store.js';
import { CouriersCollection } from '../../src/infrastructure/mongo/couriers-collection.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MongoCourierSeedWriter } from '../../src/infrastructure/mongo/mongo-courier-seed-writer.js';
import { describeCourierStoreContract } from '../support/courier-store-contract.js';
import { courier, DELIVERY, MARKET, NOW_MS, orderId } from '../support/couriers.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_courier_test';

/** Eszamanli istek sayisi: tek bos kuryeye yarisan siparisler. */
const RACERS = 20;

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let couriers: CouriersCollection;
let store: CourierMongoStore;
let writer: MongoCourierSeedWriter;

/** Koleksiyonu verilen kuryelerle bastan yazar (seed yazicisi: tek transaction). */
async function reset(list: readonly Courier[]): Promise<CourierMongoStore> {
  await writer.replaceAll(list);
  return store;
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    // Uretimdeki gibi sureli (#51): atama ve transaction bu ayarla kosar.
    operationTimeoutMs: 2_000,
  });
  couriers = new CouriersCollection(connection.db);
  await couriers.ensureIndexes();
  store = new CourierMongoStore(couriers);
  writer = new MongoCourierSeedWriter(connection, couriers);
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describeCourierStoreContract('mongo', reset);

describe('indeksler', () => {
  it('atama indeksi ve kismi benzersiz currentOrderId kurulu', async () => {
    const indexes = await connection.db.collection(COLLECTIONS.COURIERS).indexes();
    const byName = (name: string) => indexes.find((index) => index.name === name);

    expect(byName('marketId_status_lastAssignedAt')?.key).toEqual({
      marketId: 1,
      status: 1,
      lastAssignedAt: 1,
      _id: 1,
    });
    expect(byName('currentOrderId_unique')).toMatchObject({
      key: { currentOrderId: 1 },
      unique: true,
      partialFilterExpression: { currentOrderId: { $exists: true } },
    });
  });

  it('atama sorgusu koleksiyonu taramaz, indeksten okur', async () => {
    await reset([courier(1), courier(2)]);

    const plan = (await connection.db
      .collection(COLLECTIONS.COURIERS)
      .find({ marketId: MARKET, status: COURIER_STATUS.IDLE })
      .sort({ lastAssignedAt: 1, _id: 1 })
      .limit(1)
      .explain()) as { queryPlanner: { winningPlan: unknown } };

    const winning = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(winning).toContain('marketId_status_lastAssignedAt');
    expect(winning).not.toContain('COLLSCAN');
    expect(winning).not.toContain('"SORT"');
  });
});

describe('gRPC uzerinden eszamanli atama (gercek Mongo)', () => {
  let server: TestGrpcServer | undefined;

  const assign = async (order: string) => {
    if (server === undefined) throw new Error('test sunucusu henuz baslamadi');
    return server.call(
      courierV1.CourierServiceService.assignCourier,
      courierV1.AssignCourierRequest.fromPartial({
        orderId: order,
        marketId: MARKET,
        deliveryLocation: DELIVERY,
      }),
    );
  };

  beforeAll(async () => {
    server = await startTestGrpcServer({
      serviceName: 'courier-int',
      services: [buildCourierService({ couriers: store, clock: fixedClock(NOW_MS) })],
    });
  });

  afterAll(async () => {
    await server?.stop();
  });

  it(`B7: tek bos kurye, ${RACERS} eszamanli siparis -> biri atanir, digerleri NOT_FOUND`, async () => {
    await reset([courier(1)]);
    const orders = Array.from({ length: RACERS }, () => orderId());

    const results = await Promise.all(orders.map((order) => assign(order)));

    const winners = results.filter((result) => result.error === undefined);
    const losers = results.filter((result) => result.error !== undefined);
    expect(winners).toHaveLength(1);
    expect(losers.map((result) => result.error?.code)).toEqual(
      Array.from({ length: RACERS - 1 }, () => GRPC_STATUS.NOT_FOUND),
    );
    const holder = await couriers.findById(courier(1).id);
    expect(holder?.status).toBe(COURIER_STATUS.BUSY);
    expect(holder?.currentOrderId).toBe(winners[0]?.response?.courier?.currentOrderId);
  });

  it('cok kurye, cok siparis: her siparise farkli kurye; fazla siparis NOT_FOUND', async () => {
    await reset([courier(1), courier(2), courier(3)]);
    const orders = Array.from({ length: 5 }, () => orderId());

    const results = await Promise.all(orders.map((order) => assign(order)));

    const assigned = results.flatMap((result) => result.response?.courier?.id ?? []);
    expect(new Set(assigned).size).toBe(3);
    expect(
      results.flatMap((result) => (result.error === undefined ? [] : [result.error.code])),
    ).toEqual([GRPC_STATUS.NOT_FOUND, GRPC_STATUS.NOT_FOUND]);
  });

  it('ayni siparis eszamanli 10 kez istenir: hepsi ayni kuryeyi alir, tek kurye BUSY', async () => {
    await reset([courier(1), courier(2), courier(3)]);
    const order = orderId();

    const results = await Promise.all(Array.from({ length: 10 }, () => assign(order)));

    expect(results.map((result) => result.error)).toEqual(Array(10).fill(undefined));
    const ids = new Set(results.map((result) => result.response?.courier?.id));
    expect(ids.size).toBe(1);
    expect(await couriers.count({ status: COURIER_STATUS.BUSY })).toBe(1);
  });

  it('TEK kurye, ayni siparis eszamanli 10 kez: hepsi o kuryeyi alir, NOT_FOUND yok (QA B1)', async () => {
    await reset([courier(1)]);
    const order = orderId();

    const results = await Promise.all(Array.from({ length: 10 }, () => assign(order)));

    expect(results.map((result) => result.error?.code)).toEqual(Array(10).fill(undefined));
    expect(new Set(results.map((result) => result.response?.courier?.id))).toEqual(
      new Set([courier(1).id]),
    );
    expect((await couriers.findById(courier(1).id))?.currentOrderId).toBe(order);
  });

  it('sozlesme disi siparis kimligi depoya hic ulasmaz', async () => {
    await reset([courier(1)]);

    const { error } = await assign(newId(ID_PREFIX.USER));

    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((await couriers.findById(courier(1).id))?.status).toBe(COURIER_STATUS.IDLE);
  });
});

describe('acilis ve seed', () => {
  it('openCourierStore gocleri ve indeksleri kurar, depoyu acar ve kapatir', async () => {
    const otherDb = 'getir_courier_acilis';
    const opened = await openCourierStore(
      {
        uri: `${container.getConnectionString()}?directConnection=true`,
        dbName: otherDb,
        serverSelectionTimeoutMs: 5_000,
        operationTimeoutMs: 2_000,
      },
      { logger: silentLogger, clock: fixedClock(NOW_MS) },
    );

    try {
      expect(opened.name).toBe('mongo');
      const names = (await connection.client.db(otherDb).collection(COLLECTIONS.COURIERS).indexes())
        .map((index) => index.name)
        .sort();
      expect(names).toEqual(['_id_', 'currentOrderId_unique', 'marketId_status_lastAssignedAt']);
      expect(await opened.repository.findById(courier(1).id)).toBeNull();
    } finally {
      await opened.close();
    }
  });

  it('seed demo kuryelerini yazar; tekrar kosunca atanmis kurye IDLE a doner', async () => {
    const seed = createSeedCouriers({
      writer,
      seeds: COURIER_SEEDS,
      isProduction: false,
      clock: fixedClock(NOW_MS),
    });

    expect(await seed()).toEqual({ markets: 21, couriers: 63 });
    const first = COURIER_SEEDS[0];
    if (first === undefined) throw new Error('demo kuryesi yok');
    await store.claimLeastRecentlyAssigned({
      marketId: first.marketId,
      orderId: orderId(),
      at: new Date(NOW_MS),
    });
    expect(await couriers.count({ status: COURIER_STATUS.BUSY })).toBe(1);

    await seed();

    expect(await couriers.count({})).toBe(63);
    expect(await couriers.count({ status: COURIER_STATUS.IDLE })).toBe(63);
  });
});
