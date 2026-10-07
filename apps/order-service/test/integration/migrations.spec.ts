/**
 * Order servisinin gocleri gercek Mongo'da (T10.4, ADR-19). Goc 0001 (T13.2,
 * #92) alan oncesi kurye bekleyen siparislere kuyruk anini (courierQueuedAt)
 * yazar: kuryesi olmayan PAID ve kuryesiz bekleyen PREPARING. Bitti tanimi:
 * up -> down -> up ayni veriyi verir ve iscinin bekleyen sorgusu gocten sonra
 * eski siparisleri odeme sirasiyla bulur.
 *
 * Calistirici yalnizca 0001'i bilir: `down` en son gocu geri alir, sonraki
 * gocler (0002, migration-0002.spec.ts) bu dosyanin down'unu kendine cekmesin.
 */

import { fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { connectMongo, createMigrationRunner } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withAssignedCourier, withCourierRetry } from '../../src/domain/courier-dispatch.js';
import type { Order } from '../../src/domain/order.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { toOrderDocument } from '../../src/infrastructure/mongo/mappers.js';
import { OrderMongoStore } from '../../src/infrastructure/mongo/order-mongo-store.js';
import { OrdersCollection } from '../../src/infrastructure/mongo/orders-collection.js';
import { OutboxCollection } from '../../src/infrastructure/mongo/outbox-collection.js';
import { courierQueue } from '../../src/migrations/0001-kurye-sirasi.js';
import { sampleDraftInput } from '../support/order-builders.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_order_goc_test';
const QUEUE_INDEX = 'status_courierQueuedAt_id';
const T0 = Date.UTC(2026, 9, 4, 8, 0);
const MINUTE = 60_000;

let container: StartedMongoDBContainer;
let connection: MongoConnection;

const orders = () => connection.db.collection<Document>(COLLECTIONS.ORDERS);
const runner = () =>
  createMigrationRunner({ connection, migrations: [courierQueue], logger: silentLogger });

const TO_PAID: readonly OrderStatus[] = [
  ORDER_STATUS.RISK_CHECK,
  ORDER_STATUS.RESERVED,
  ORDER_STATUS.AWAITING_PAYMENT,
  ORDER_STATUS.PAID,
];

/** `createdMs`'de acilip `paidMs`'de odenmis siparis (alan oncesi: kuyruk ani yok). */
function paidOrder(createdMs: number, paidMs: number): Order {
  const draft = createDraftOrder(sampleDraftInput(), fixedClock(createdMs));
  const awaiting = TO_PAID.slice(0, 3).reduce<Order>(
    (order, status) => transitionOrder(order, status, fixedClock(createdMs)),
    draft,
  );
  return transitionOrder(awaiting, ORDER_STATUS.PAID, fixedClock(paidMs));
}

/** T13.1 bicimi: kuyruk ani alani hic yok. */
function t131Document(order: Order): Document {
  const { courierQueuedAt: _notYet, ...document } = toOrderDocument(order);
  return document;
}

const paid = paidOrder(T0, T0 + 2 * MINUTE);
const waiting = withCourierRetry(
  paidOrder(T0, T0 + MINUTE),
  new Date(T0 + 40 * MINUTE),
  fixedClock(T0 + MINUTE),
);
const assigned = withAssignedCourier(
  paidOrder(T0, T0 + 3 * MINUTE),
  'crr_1',
  fixedClock(T0 + 4 * MINUTE),
);
/** Odeme kaydi olmayan PAID (bozuk ya da cok eski): olusturma anina duser. */
const paidWithoutEntry: Order = {
  ...paidOrder(T0 - MINUTE, T0 + 5 * MINUTE),
  timeline: [{ status: ORDER_STATUS.DRAFT, at: new Date(T0 - MINUTE) }],
};
/** T13.1 oncesi kuryesiz PREPARING (deneme ani yok): iscinin disinda kalir. */
const legacyPreparing = transitionOrder(
  paidOrder(T0, T0 + 6 * MINUTE),
  ORDER_STATUS.PREPARING,
  fixedClock(T0 + 7 * MINUTE),
);

async function queueTimes(): Promise<Record<string, unknown>> {
  const rows = await orders()
    .find({}, { projection: { courierQueuedAt: 1 } })
    .toArray();
  return Object.fromEntries(rows.map((row) => [String(row['_id']), row['courierQueuedAt']]));
}

async function indexNames(): Promise<string[]> {
  return (await orders().indexes()).map((index) => String(index.name));
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    operationTimeoutMs: 5_000,
  });
  await orders().insertMany(
    [paid, waiting, assigned, paidWithoutEntry, legacyPreparing].map(t131Document),
  );
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describe('goc 0001 kurye-sirasi', () => {
  let firstUp: Record<string, unknown>;

  it('up: kuryesiz PAID ve bekleyen PREPARING e odeme ani; digerlerine dokunulmaz', async () => {
    await runner().up();

    firstUp = await queueTimes();
    expect(firstUp).toEqual({
      [paid.id]: new Date(T0 + 2 * MINUTE),
      [waiting.id]: new Date(T0 + MINUTE),
      [paidWithoutEntry.id]: new Date(T0 - MINUTE),
      [assigned.id]: undefined,
      [legacyPreparing.id]: undefined,
    });
  });

  it('gocten sonra kuyruk indeksi kurulur; bekleyen sorgusu eski bekleyeni odeme sirasiyla bulur', async () => {
    const collection = new OrdersCollection(connection.db);
    await collection.ensureIndexes();
    const store = new OrderMongoStore(collection, new OutboxCollection(connection.db), connection);

    expect(await indexNames()).toContain(QUEUE_INDEX);
    const found = await store.findWaitingBefore(new Date(T0 + 2 * MINUTE), 10);
    expect(found.map((order) => order.id)).toEqual([waiting.id]);
    expect(found[0]?.courierQueuedAt).toEqual(new Date(T0 + MINUTE));
  });

  it('down: alan her belgeden silinir, kuyruk indeksi duser', async () => {
    await runner().down();

    expect(Object.values(await queueTimes()).every((value) => value === undefined)).toBe(true);
    expect(await indexNames()).not.toContain(QUEUE_INDEX);
    expect(await indexNames()).toContain('status_courierRetryAt_id');
  });

  it('yeniden up: ilk up ile ayni veri', async () => {
    await runner().up();

    expect(await queueTimes()).toEqual(firstUp);
  });

  it('up tekrar calisirsa alani olan belgeye dokunmaz', async () => {
    await orders().updateOne({ _id: paid.id } as Document, {
      $set: { courierQueuedAt: new Date(T0 + 9 * MINUTE) },
    });

    await courierQueue.up({ db: connection.db, session: undefined, logger: silentLogger });

    expect((await queueTimes())[paid.id]).toEqual(new Date(T0 + 9 * MINUTE));
  });
});
