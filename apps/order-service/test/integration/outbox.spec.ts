/**
 * Outbox gercek Mongo + Redis'te (Testcontainers), T7.3:
 *  1. Sozlesme gercek transaction'da: siparis yazildi ama olay yazilamadi ->
 *     siparis de geri alinir (ADR-04).
 *  2. Es zamanli yazim: baska bir transaction ayni siparisi tutarken yazan
 *     kaybeden INTERNAL degil CONFLICT alir, olayi yazilmaz (inceleme bulgusu).
 *  3. Yayincinin sorgusu indeksten sirali okunur.
 *  4. "Bitti sayilir": stream:events olaylari gorulur. Servisin acilis yolu
 *     (openOrderStore) ve yayinci (startEventPublishing) main.ts'teki gibi.
 */

import { ERROR_CODES, fixedClock, ORDER_STATUS, RISK_BANDS, silentLogger } from '@getir/core';
import { fromStreamFields, RedisStreamsPublisher } from '@getir/event-bus';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import type { EventEnvelope } from '@getir/event-bus';
import { connectRedis, EVENTS_STREAM_KEY } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startEventPublishing } from '../../src/bootstrap.js';
import { applyRiskDecision, decideRisk } from '../../src/domain/checkout-risk.js';
import { orderCreatedEvents, statusChangedEvents } from '../../src/domain/order-events.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import type { Order } from '../../src/domain/order.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MongoOrderOutbox } from '../../src/infrastructure/mongo/mongo-order-outbox.js';
import { OrderMongoStore } from '../../src/infrastructure/mongo/order-mongo-store.js';
import { OrdersCollection } from '../../src/infrastructure/mongo/orders-collection.js';
import { OutboxCollection } from '../../src/infrastructure/mongo/outbox-collection.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';
import type { OrderStore } from '../../src/infrastructure/order-store.js';
import { sampleDraftInput } from '../support/order-builders.js';
import { describeOrderOutboxContract } from '../support/order-outbox-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surumler. */
const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const DB_NAME = 'getir_order_outbox_test';
const INTERVAL_MS = 20;
/** Diger transaction'in commit etmeden bekledigi sure: kaybeden bu surede tekrar dener. */
const HOLD_MS = 300;
const WAIT_BUDGET_MS = 5_000;
const clock = fixedClock(1_760_000_000_000);

let mongo: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
let store: OrderStore;
/** Ayni veritabanina ikinci baglanti: iz kaynagi verilen depo icin (D16). */
let correlatedConnection: MongoConnection;
let redis: RedisConnection;
/** Ham istemci: servisin disinda baska bir transaction ve explain icin. */
let raw: MongoClient;

const explainSchema = z.object({ queryPlanner: z.object({ winningPlan: z.unknown() }) });

beforeAll(async () => {
  [mongo, redisContainer] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  const uri = `${mongo.getConnectionString()}?directConnection=true`;
  store = await openOrderStore(
    { uri, dbName: DB_NAME, serverSelectionTimeoutMs: 5_000 },
    silentLogger,
    'test',
  );
  raw = await MongoClient.connect(uri);
  correlatedConnection = await connectMongo({
    uri,
    dbName: DB_NAME,
    serverSelectionTimeoutMs: 5_000,
    appName: 'order-outbox-test',
    logger: silentLogger,
  });
  redis = await connectRedis({ url: redisContainer.getConnectionUrl(), name: 'order-outbox-test' });
});

afterAll(async () => {
  await correlatedConnection?.close();
  await raw?.close();
  await redis?.close();
  await store?.close();
  await Promise.all([mongo?.stop(), redisContainer?.stop()]);
});

async function streamEvents(): Promise<EventEnvelope[]> {
  const entries = await redis.redis.xrange(EVENTS_STREAM_KEY, '-', '+');
  return entries.map(([, fields]) => fromStreamFields(fields));
}

/**
 * Outbox'ta yayinlanmamis olay kalmayana kadar bekler (isci aralikla calisir).
 * Akis uzunlugu degil bu beklenir: ayni dosyadaki sozlesme testlerinin olaylari
 * da yayina girer, sayim onlarla kayardi.
 */
async function waitUntilOutboxDrained(): Promise<void> {
  const deadline = Date.now() + WAIT_BUDGET_MS;
  while ((await store.outbox.pending(1)).length > 0) {
    if (Date.now() > deadline) {
      throw new Error('outbox bosalmadi');
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

/** Bu siparisin akistaki olaylari (baska testlerin olaylari haric). */
async function orderStreamEvents(orderId: string): Promise<EventEnvelope[]> {
  return (await streamEvents()).filter((event) => event.partitionKey === orderId);
}

/** Taslak + risk adimi, olaylariyla (use-case'lerin yazdigi gibi). */
async function awaitingPaymentOrder(): Promise<Order> {
  const draft = createDraftOrder(sampleDraftInput(), clock);
  await store.repository.insert(draft, orderCreatedEvents(draft));
  const awaiting = applyRiskDecision(draft, RISK_BANDS.LOW, decideRisk(RISK_BANDS.LOW), clock);
  await store.repository.update(awaiting, draft.version, statusChangedEvents(draft, awaiting));
  return awaiting;
}

describeOrderOutboxContract(
  'mongo',
  () => ({ repository: store.repository, outbox: store.outbox }),
  (source) => {
    const outbox = new OutboxCollection(correlatedConnection.db);
    return {
      repository: new OrderMongoStore(
        new OrdersCollection(correlatedConnection.db),
        outbox,
        correlatedConnection,
        source,
      ),
      outbox: new MongoOrderOutbox(outbox, source),
    };
  },
);

describe('es zamanli yazim ve indeks (gercek Mongo)', () => {
  it('baska transaction siparisi tutarken yazan kaybeden CONFLICT alir, olayi yazilmaz', async () => {
    const draft = createDraftOrder(sampleDraftInput({ userId: 'usr_yaris' }), clock);
    await store.repository.insert(draft, []);
    const holder = raw.startSession();
    try {
      // Kazanan: ayni siparise yazdi ama henuz COMMIT etmedi.
      holder.startTransaction();
      await raw
        .db(DB_NAME)
        .collection<{ _id: string; version: number }>(COLLECTIONS.ORDERS)
        .updateOne({ _id: draft.id }, { $inc: { version: 1 } }, { session: holder });

      const loser = transitionOrder(draft, ORDER_STATUS.RISK_CHECK, clock);
      const contender = store.repository.update(
        loser,
        draft.version,
        statusChangedEvents(draft, loser),
      );
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      await holder.commitTransaction();

      // Duzeltmeden once burada INTERNAL donuyordu ve saga'nin iadesi calismiyordu.
      await expect(contender).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
        details: { orderId: draft.id, expectedVersion: draft.version },
      });
      const pending = await store.outbox.pending(100);
      expect(pending.filter((event) => event.orderId === draft.id)).toEqual([]);
    } finally {
      await holder.endSession();
    }
  });

  it('yayincinin sorgusu indeksten sirali okunur, bellekte SORT yok', async () => {
    const plan: Document = await raw
      .db(DB_NAME)
      .collection(COLLECTIONS.OUTBOX)
      .find({ publishedAt: null })
      .sort({ occurredAt: 1, version: 1, _id: 1 })
      .explain('queryPlanner');

    const winning = JSON.stringify(explainSchema.parse(plan).queryPlanner.winningPlan);
    expect(winning).toContain('publishedAt_occurredAt_version_id');
    expect(winning).not.toContain('"stage":"SORT"');
  });
});

describe('outbox -> stream:events (T7.3)', () => {
  it('siparisin olaylari akista yazim sirasiyla gorulur; outbox bosalir', async () => {
    const order = await awaitingPaymentOrder();
    const worker = startEventPublishing({
      outbox: store.outbox,
      publisher: new RedisStreamsPublisher(redis.redis),
      logger: silentLogger,
      intervalMs: INTERVAL_MS,
    });

    await waitUntilOutboxDrained();
    await worker.stop();

    const events = await orderStreamEvents(order.id);
    expect(
      events.map((event) => [event.topic, event.payload['to'] ?? event.payload['status']]),
    ).toEqual([
      ['order.created', 'DRAFT'],
      ['order.status_changed', 'RISK_CHECK'],
      ['order.status_changed', 'RESERVED'],
      ['order.status_changed', 'AWAITING_PAYMENT'],
    ]);
    await expect(store.outbox.pending(10)).resolves.toEqual([]);
  });

  it('isci yeniden baslayinca yalnizca YENI olay gider (yayinlanan tekrar gitmez)', async () => {
    const order = await awaitingPaymentOrder();
    const first = startEventPublishing({
      outbox: store.outbox,
      publisher: new RedisStreamsPublisher(redis.redis),
      logger: silentLogger,
      intervalMs: INTERVAL_MS,
    });
    await waitUntilOutboxDrained();
    await first.stop();

    const paid = transitionOrder(order, ORDER_STATUS.PAID, clock);
    await store.repository.update(paid, order.version, statusChangedEvents(order, paid));
    const second = startEventPublishing({
      outbox: store.outbox,
      publisher: new RedisStreamsPublisher(redis.redis),
      logger: silentLogger,
      intervalMs: INTERVAL_MS,
    });
    await waitUntilOutboxDrained();
    await second.stop();

    // Her surum akista TAM BIR KEZ: yayinlanan olay ikinci iscide tekrar gitmedi.
    const events = await orderStreamEvents(order.id);
    expect(events.map((event) => event.payload['version'])).toEqual([1, 2, 3, 4, 5]);
  });
});
