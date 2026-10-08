/**
 * Goc 0003 (#166, iade-isareti) gercek Mongo'da: outbox'taki iade komutlarindan
 * (payment.refund_requested) iptal edilmis siparislere kalici iade isareti ve
 * inHistory yazar. Bitti tanimi: en eski komut secilir (belirlenimci); iptal
 * edilmemis, isaretli ya da komutsuz siparise dokunulmaz; bicimsiz satir atlanir;
 * gocten sonra ListMyOrders bu siparisleri verir; down isareti siler ve
 * inHistory'yi 0002 kuralina dondurur; yeniden up ayni veri; tekrar calismasi zararsiz.
 */

import { fixedClock, ID_PREFIX, newId, ORDER_STATUS, silentLogger } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { connectMongo, createMigrationRunner } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Order } from '../../src/domain/order.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { toOrderDocument } from '../../src/infrastructure/mongo/mappers.js';
import { OrderMongoStore } from '../../src/infrastructure/mongo/order-mongo-store.js';
import { OrdersCollection } from '../../src/infrastructure/mongo/orders-collection.js';
import { OutboxCollection } from '../../src/infrastructure/mongo/outbox-collection.js';
import { EARLIEST_REFUND_PER_ORDER, refundMark } from '../../src/migrations/0003-iade-isareti.js';
import { MIGRATIONS } from '../../src/migrations/index.js';
import { sampleDraftInput } from '../support/order-builders.js';
import { TO_PAID } from '../support/order-store-fixtures.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_order_goc_iade_test';
const USER_ID = 'usr_goc-iade';
const T0 = Date.UTC(2026, 9, 8, 8, 0);
const MINUTE = 60_000;
const S = ORDER_STATUS;
const TO_AWAITING: readonly OrderStatus[] = TO_PAID.slice(0, 3);
const LAPSED_REASON = 'reservation_expired';
const CROSS_REASON = 'order_changed_during_payment';

let container: StartedMongoDBContainer;
let connection: MongoConnection;

const orders = () => connection.db.collection<Document>(COLLECTIONS.ORDERS);
const outbox = () => connection.db.collection<Document>(COLLECTIONS.OUTBOX);
const runner = () =>
  createMigrationRunner({ connection, migrations: MIGRATIONS, logger: silentLogger });
const at = (minute: number): Date => new Date(T0 + minute * MINUTE);

function orderAt(minute: number, steps: readonly OrderStatus[], note?: string): Order {
  const clock = fixedClock(T0 + minute * MINUTE);
  const draft = createDraftOrder(sampleDraftInput({ userId: USER_ID }), clock);
  return steps.reduce<Order>(
    (order, status, index) =>
      transitionOrder(order, status, clock, index === steps.length - 1 ? note : undefined),
    draft,
  );
}

/** Kilidi dusup parasi iade edilen (iki komut: biri gec ve baska gerekceli). */
const lapsed = orderAt(0, [...TO_AWAITING, S.CANCELLED], 'RESERVATION_EXPIRED');
/** Baska yol iptal etti, iade komutu outbox'ta (dogrudan iade basarisizdi). */
const crossed = orderAt(1, [...TO_AWAITING, S.CANCELLED], 'USER_CANCELLED');
/** Iptal ama komut yok: para alinmamis (ya da dogrudan iadesi basarili eski kayit). */
const plainCancel = orderAt(2, [...TO_AWAITING, S.CANCELLED], 'USER_CANCELLED');
/** Komut var ama siparis iptal edilmemis (odenmis): dokunulmaz. */
const paid = orderAt(3, TO_PAID);
/** Yeni kodun yazdigi: isaret zaten var (gerekce farkli), komut da var. */
const alreadyMarked: Order = {
  ...orderAt(4, [...TO_AWAITING, S.CANCELLED], 'RESERVATION_EXPIRED'),
  refund: { reason: CROSS_REASON, requestedAt: at(40) },
};
const all = [lapsed, crossed, plainCancel, paid, alreadyMarked];

function refundRow(orderId: string, minute: number, payload: Record<string, unknown>): Document {
  return {
    _id: newId(ID_PREFIX.EVENT),
    topic: 'payment.refund_requested',
    aggregateId: orderId,
    version: 5,
    occurredAt: at(minute),
    payload: { orderId, idempotencyKey: `refund-${orderId}`, ...payload },
    publishedAt: at(minute + 1),
  };
}

const outboxRows: Document[] = [
  refundRow(lapsed.id, 15, { reason: CROSS_REASON }),
  refundRow(lapsed.id, 10, { reason: LAPSED_REASON }),
  refundRow(crossed.id, 11, { reason: CROSS_REASON }),
  refundRow(paid.id, 12, { reason: CROSS_REASON }),
  refundRow(alreadyMarked.id, 13, { reason: LAPSED_REASON }),
  refundRow(newId(ID_PREFIX.ORDER), 14, { reason: LAPSED_REASON }),
  // Bicimsiz (gerekce yok): atlanir.
  refundRow(plainCancel.id, 16, {}),
  // Baska konu: okunmaz.
  { ...refundRow(plainCancel.id, 17, { reason: LAPSED_REASON }), topic: 'order.status_changed' },
];

/** #166 oncesi bicim: isaret yok (alreadyMarked haric: onu yeni kod yazdi). */
function documentOf(order: Order): Document {
  return toOrderDocument(order);
}

async function snapshot(): Promise<Record<string, { refund: unknown; inHistory: unknown }>> {
  const rows = await orders()
    .find({}, { projection: { refund: 1, inHistory: 1 } })
    .toArray();
  return Object.fromEntries(
    rows.map((row) => {
      const refund: unknown = row['refund'];
      const inHistory: unknown = row['inHistory'];
      return [String(row['_id']), { refund, inHistory }];
    }),
  );
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    operationTimeoutMs: 5_000,
  });
  await orders().insertMany(all.map(documentOf));
  await outbox().insertMany(outboxRows);
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describe('goc 0003 iade-isareti', () => {
  let firstUp: Awaited<ReturnType<typeof snapshot>>;

  it('up: en eski komutla isaret ve inHistory; iptal edilmemis, isaretli ve komutsuz siparise dokunulmaz', async () => {
    await runner().up();

    firstUp = await snapshot();
    expect(firstUp).toEqual({
      [lapsed.id]: { refund: { reason: LAPSED_REASON, requestedAt: at(10) }, inHistory: true },
      [crossed.id]: { refund: { reason: CROSS_REASON, requestedAt: at(11) }, inHistory: true },
      [plainCancel.id]: { refund: undefined, inHistory: false },
      [paid.id]: { refund: undefined, inHistory: true },
      [alreadyMarked.id]: {
        refund: { reason: CROSS_REASON, requestedAt: at(40) },
        inHistory: true,
      },
    });
  });

  it('gocten sonra ListMyOrders iade edilen siparisleri verir, komutsuz iptali vermez', async () => {
    const collection = new OrdersCollection(connection.db);
    await collection.ensureIndexes();
    const store = new OrderMongoStore(collection, new OutboxCollection(connection.db), connection);

    const page = await store.listByUser({ userId: USER_ID, pageSize: 50 });

    expect(page.orders.map((order) => order.id).sort()).toEqual(
      [lapsed.id, crossed.id, paid.id, alreadyMarked.id].sort(),
    );
    const read = page.orders.find((order) => order.id === lapsed.id);
    expect(read?.refund).toEqual({ reason: LAPSED_REASON, requestedAt: at(10) });
  });

  it('down: isaret silinir, inHistory 0002 kuralina doner; 0002 ve 0001 kalir', async () => {
    const reverted = await runner().down();

    expect(reverted?.name).toBe(refundMark.name);
    expect(await snapshot()).toEqual({
      [lapsed.id]: { refund: undefined, inHistory: false },
      [crossed.id]: { refund: undefined, inHistory: false },
      [plainCancel.id]: { refund: undefined, inHistory: false },
      [paid.id]: { refund: undefined, inHistory: true },
      [alreadyMarked.id]: { refund: undefined, inHistory: false },
    });
    expect((await runner().status()).applied.map((record) => record._id)).toEqual([1, 2]);
  });

  it('yeniden up: komutlardan geri gelir (yeni kodun isareti de komutundan)', async () => {
    await runner().up();

    expect(await snapshot()).toEqual({
      ...firstUp,
      [alreadyMarked.id]: {
        refund: { reason: LAPSED_REASON, requestedAt: at(13) },
        inHistory: true,
      },
    });
  });

  it('up tekrar calisirsa isaretli siparise dokunmaz', async () => {
    await orders().updateOne({ _id: lapsed.id } as Document, {
      $set: { refund: { reason: 'elle', requestedAt: at(50) } },
    });

    await refundMark.up({ db: connection.db, session: undefined, logger: silentLogger });

    expect((await snapshot())[lapsed.id]).toEqual({
      refund: { reason: 'elle', requestedAt: at(50) },
      inHistory: true,
    });
  });
});

/** #185 N7 oncesi toplama (donmus kopya): global $sort + $first, tarih denetimi yok. */
const EARLIEST_REFUND_PER_ORDER_BEFORE_N7: Document[] = [
  { $match: { topic: 'payment.refund_requested', 'payload.reason': { $type: 'string' } } },
  { $sort: { occurredAt: 1, _id: 1 } },
  {
    $group: {
      _id: '$aggregateId',
      reason: { $first: '$payload.reason' },
      requestedAt: { $first: '$occurredAt' },
    },
  },
];

async function aggregateSorted(collection: string, pipeline: Document[]): Promise<Document[]> {
  const rows = await connection.db.collection<Document>(collection).aggregate(pipeline).toArray();
  return rows.sort((left, right) => String(left['_id']).localeCompare(String(right['_id'])));
}

describe('goc 0003 toplamasi: N7 oncesi ve sonrasi (#185)', () => {
  it('gecerli veride ayni cikti (en eski komut, esitlikte _id)', async () => {
    const before = await aggregateSorted(COLLECTIONS.OUTBOX, EARLIEST_REFUND_PER_ORDER_BEFORE_N7);
    const after = await aggregateSorted(COLLECTIONS.OUTBOX, EARLIEST_REFUND_PER_ORDER);

    expect(after).toEqual(before);
    expect(after.length).toBeGreaterThan(0);
  });

  it('esit anli iki komut: ikisi de _id sirasiyla ayni komutu secer', async () => {
    const orderId = newId(ID_PREFIX.ORDER);
    const rows: Document[] = [
      { ...refundRow(orderId, 30, { reason: CROSS_REASON }), _id: 'evt_b' },
      { ...refundRow(orderId, 30, { reason: LAPSED_REASON }), _id: 'evt_a' },
    ];
    await connection.db.collection<Document>('outbox_n7_esit').insertMany(rows);

    const before = await aggregateSorted('outbox_n7_esit', EARLIEST_REFUND_PER_ORDER_BEFORE_N7);
    const after = await aggregateSorted('outbox_n7_esit', EARLIEST_REFUND_PER_ORDER);

    expect(after).toEqual(before);
    expect(after).toEqual([{ _id: orderId, reason: LAPSED_REASON, requestedAt: at(30) }]);
  });

  it('tarihi bicimsiz satir artik en eski sayilmaz (oncesinde siparis atlanirdi)', async () => {
    const orderId = newId(ID_PREFIX.ORDER);
    await connection.db
      .collection<Document>('outbox_n7_tarih')
      .insertMany([
        { ...refundRow(orderId, 5, { reason: CROSS_REASON }), occurredAt: '2026-10-08T08:05:00Z' },
        refundRow(orderId, 20, { reason: LAPSED_REASON }),
      ]);

    const before = await aggregateSorted('outbox_n7_tarih', EARLIEST_REFUND_PER_ORDER_BEFORE_N7);
    const after = await aggregateSorted('outbox_n7_tarih', EARLIEST_REFUND_PER_ORDER);

    // BSON sirasinda metin tarihten once gelir: eski toplama metni secer, zod onu atlar.
    expect(before).toEqual([
      { _id: orderId, reason: CROSS_REASON, requestedAt: '2026-10-08T08:05:00Z' },
    ]);
    expect(after).toEqual([{ _id: orderId, reason: LAPSED_REASON, requestedAt: at(20) }]);
  });
});
