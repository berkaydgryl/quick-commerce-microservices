/**
 * Goc 0002 (#101, gecmis-gorunurlugu) gercek Mongo'da: alan oncesi siparislere
 * `inHistory`'yi durum ve zaman cizelgesinden yazar. Bitti tanimi: up her
 * durumu kurala gore isaretler (bugun domain isListedInHistory ile ayni sonuc);
 * gocten sonra ListMyOrders eski siparislerden yalnizca gorunenleri verir;
 * down alani ve kismi indeksi kaldirir; yeniden up ayni veri; up tekrar
 * calisirsa alani olan belgeye dokunmaz.
 */

import { fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { connectMongo, createMigrationRunner } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isListedInHistory } from '../../src/domain/order-history-listing.js';
import type { Order } from '../../src/domain/order.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { HISTORY_INDEX_NAME } from '../../src/infrastructure/mongo/history-query.js';
import { toOrderDocument } from '../../src/infrastructure/mongo/mappers.js';
import { OrderMongoStore } from '../../src/infrastructure/mongo/order-mongo-store.js';
import { OrdersCollection } from '../../src/infrastructure/mongo/orders-collection.js';
import { OutboxCollection } from '../../src/infrastructure/mongo/outbox-collection.js';
import { courierQueue } from '../../src/migrations/0001-kurye-sirasi.js';
import { historyVisibility } from '../../src/migrations/0002-gecmis-gorunurlugu.js';
import { sampleDraftInput } from '../support/order-builders.js';
import { TO_PAID } from '../support/order-store-fixtures.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_order_goc_gecmis_test';
const USER_ID = 'usr_goc-gecmis';
const T0 = Date.UTC(2026, 9, 7, 8, 0);
const MINUTE = 60_000;
const S = ORDER_STATUS;
const TO_AWAITING: readonly OrderStatus[] = TO_PAID.slice(0, 3);

let container: StartedMongoDBContainer;
let connection: MongoConnection;

const orders = () => connection.db.collection<Document>(COLLECTIONS.ORDERS);
const runner = () =>
  // Calistirici 0002'ye kadar bilir: `down` en son gocu geri alir, sonraki gocler
  // (0003, migration-0003.spec.ts) bu dosyanin down'unu kendine cekmesin.
  createMigrationRunner({
    connection,
    migrations: [courierQueue, historyVisibility],
    logger: silentLogger,
  });

/** `minute`'ta acilip `steps` yolundan gecen, son adimi `note` notlu siparis. */
function orderAt(minute: number, steps: readonly OrderStatus[], note?: string): Order {
  const clock = fixedClock(T0 + minute * MINUTE);
  const draft = createDraftOrder(sampleDraftInput({ userId: USER_ID }), clock);
  return steps.reduce<Order>(
    (order, status, index) =>
      transitionOrder(order, status, clock, index === steps.length - 1 ? note : undefined),
    draft,
  );
}

const hidden: readonly Order[] = [
  orderAt(0, []),
  orderAt(2, [S.RISK_CHECK, S.RESERVED]),
  orderAt(4, TO_AWAITING),
  orderAt(6, [S.RISK_CHECK, S.RESERVED, S.EXPIRED]),
  orderAt(8, [...TO_AWAITING, S.PAYMENT_FAILED]),
  orderAt(10, [S.RISK_CHECK, S.REJECTED]),
  orderAt(12, [S.CANCELLED], 'CART_RELEASED'),
  orderAt(14, [...TO_AWAITING, S.CANCELLED], 'USER_CANCELLED'),
  orderAt(16, [...TO_AWAITING, S.PAYMENT_FAILED, S.CANCELLED]),
];
const listed: readonly Order[] = [
  orderAt(1, [S.RISK_CHECK, S.REVIEW]),
  orderAt(3, TO_PAID),
  orderAt(5, [...TO_PAID, S.PREPARING]),
  orderAt(7, [...TO_PAID, S.PREPARING, S.ON_THE_WAY]),
  orderAt(9, [...TO_PAID, S.PREPARING, S.ON_THE_WAY, S.DELIVERED]),
  orderAt(11, [...TO_PAID, S.CANCELLED], 'RESERVATION_EXPIRED'),
];
const all = [...hidden, ...listed];

/** #101 oncesi bicim: alan hic yok. */
function legacyDocument(order: Order): Document {
  const { inHistory: _notYet, ...document } = toOrderDocument(order);
  return document;
}

async function flags(): Promise<Record<string, unknown>> {
  const rows = await orders()
    .find({}, { projection: { inHistory: 1 } })
    .toArray();
  return Object.fromEntries(rows.map((row) => [String(row['_id']), row['inHistory']]));
}

async function indexNames(): Promise<string[]> {
  return (await orders().indexes()).map((index) => String(index.name));
}

const expectedFlags = Object.fromEntries([
  ...hidden.map((order) => [order.id, false] as const),
  ...listed.map((order) => [order.id, true] as const),
]);

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    operationTimeoutMs: 5_000,
  });
  await orders().insertMany(all.map(legacyDocument));
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describe('goc 0002 gecmis-gorunurlugu', () => {
  let firstUp: Record<string, unknown>;

  it('up: gorunenler true, sepet asamasi ve odenmeden iptal false (domain kuraliyla ayni)', async () => {
    await runner().up();

    firstUp = await flags();
    expect(firstUp).toEqual(expectedFlags);
    expect(all.every((order) => firstUp[order.id] === isListedInHistory(order))).toBe(true);
  });

  it('gocten sonra kismi indeks kurulur; ListMyOrders eski siparislerden yalnizca gorunenleri verir', async () => {
    const collection = new OrdersCollection(connection.db);
    await collection.ensureIndexes();
    const store = new OrderMongoStore(collection, new OutboxCollection(connection.db), connection);

    expect(await indexNames()).toContain(HISTORY_INDEX_NAME);
    const page = await store.listByUser({ userId: USER_ID, pageSize: 50 });
    expect(page.orders.map((order) => order.id)).toEqual(
      [...listed].reverse().map((order) => order.id),
    );
  });

  it('down: alan her belgeden silinir, gecmis indeksi duser; diger indeksler ve 0001 kalir', async () => {
    const reverted = await runner().down();

    expect(reverted?.name).toBe(historyVisibility.name);
    expect(Object.values(await flags()).every((value) => value === undefined)).toBe(true);
    expect(await indexNames()).not.toContain(HISTORY_INDEX_NAME);
    expect(await indexNames()).toEqual(
      expect.arrayContaining(['userId_createdAt_id', 'status_courierQueuedAt_id']),
    );
    expect((await runner().status()).applied.map((record) => record._id)).toEqual([1]);
  });

  it('yeniden up: ilk up ile ayni veri', async () => {
    await runner().up();

    expect(await flags()).toEqual(firstUp);
  });

  it('up tekrar calisirsa alani olan belgeye dokunmaz, alani olmayani doldurur', async () => {
    const [kept, missing] = listed;
    if (kept === undefined || missing === undefined) throw new Error('veri eksik');
    await orders().updateOne({ _id: kept.id } as Document, { $set: { inHistory: false } });
    await orders().updateOne({ _id: missing.id } as Document, { $unset: { inHistory: '' } });

    await historyVisibility.up({ db: connection.db, session: undefined, logger: silentLogger });

    const after = await flags();
    expect(after[kept.id]).toBe(false);
    expect(after[missing.id]).toBe(true);
  });
});
