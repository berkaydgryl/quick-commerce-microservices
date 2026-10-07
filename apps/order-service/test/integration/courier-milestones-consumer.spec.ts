/**
 * Kurye kilometre taslari uctan uca (T14.3): gercek Mongo + gercek Redis
 * (Testcontainers).
 *
 * courier'in olaylari courier'in yayinladigi zarfla (RedisStreamsPublisher)
 * akisa duser; order'in tuketicisi main.ts'teki kurulumun aynisidir
 * (RedisStreamsConsumer + subscribeOrderEvents) ve siparisi Mongo'da ilerletir;
 * order.status_changed siparisle ayni transaction'da outbox'a yazilir. Her test
 * kendi akisini kullanir. Teslim en az bir kez ve sirasizdir: tekrar, once
 * gelen teslim, iptal edilmis siparis, kuryesi henuz yazilmamis siparis ve
 * baska kurye.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { EVENTS, fixedClock, ID_PREFIX, newId, ORDER_STATUS } from '@getir/core';
import {
  DEAD_LETTER_FIELD,
  DEAD_LETTER_REASON,
  RedisStreamsConsumer,
  RedisStreamsPublisher,
} from '@getir/event-bus';
import type { EventEnvelope } from '@getir/event-bus';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { connectRedis } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { subscribeOrderEvents } from '../../src/bootstrap.js';
import { EVENT_CONSUMER_GROUP } from '../../src/config/constants.js';
import { transitionOrder } from '../../src/domain/order.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { OrderMongoStore } from '../../src/infrastructure/mongo/order-mongo-store.js';
import { OrdersCollection } from '../../src/infrastructure/mongo/orders-collection.js';
import { OutboxCollection } from '../../src/infrastructure/mongo/outbox-collection.js';
import {
  assignCourier,
  deliveredEvent,
  insertWithCourier,
  newCourierId,
  pickedUpEvent,
} from '../support/courier-milestone-fixtures.js';
import { insertPaid } from '../support/order-builders.js';

/** infra/docker/docker-compose.dev.yml ile ayni surumler. */
const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const DB_NAME = 'getir_order_courier_events_test';
const S = ORDER_STATUS;
const clock = fixedClock(Date.UTC(2026, 9, 7, 23, 0));

let mongoContainer: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
let connection: MongoConnection;
let store: OrderMongoStore;
let admin: RedisConnection;
const started: RedisStreamsConsumer[] = [];
let streamCounter = 0;

beforeAll(async () => {
  [mongoContainer, redisContainer] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  connection = await connectMongo({
    uri: `${mongoContainer.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    operationTimeoutMs: 2_000,
  });
  const orders = new OrdersCollection(connection.db);
  const outbox = new OutboxCollection(connection.db);
  await orders.ensureIndexes();
  await outbox.ensureIndexes();
  store = new OrderMongoStore(orders, outbox, connection);
  admin = await connectRedis({ url: redisContainer.getConnectionUrl(), name: 'order-test-admin' });
});

afterEach(async () => {
  await Promise.all(started.splice(0).map((consumer) => consumer.stop()));
});

afterAll(async () => {
  await admin?.close();
  await connection?.close();
  await Promise.all([mongoContainer?.stop(), redisContainer?.stop()]);
});

interface Streams {
  readonly streamKey: string;
  readonly deadLetterKey: string;
}

function freshStreams(): Streams {
  streamCounter += 1;
  return {
    streamKey: `stream:order-courier-test-${streamCounter}`,
    deadLetterKey: `stream:order-courier-test-${streamCounter}:dead`,
  };
}

/**
 * main.ts'teki kurulum; yalnizca sureler kisa ve akis teste ozel. Teslim hakki
 * genis: kuryesi yazilmamis siparisin olayi testin yazimina kadar beklesin.
 */
async function startOrderConsumer(streams: Streams): Promise<void> {
  const consumer = new RedisStreamsConsumer({
    connect: () =>
      connectRedis({ url: redisContainer.getConnectionUrl(), name: 'order-events-test' }),
    consumerName: 'order-test-1',
    streamKey: streams.streamKey,
    deadLetterKey: streams.deadLetterKey,
    delivery: { blockMs: 50, claimIdleMs: 200, retryDelayMs: 20, maxDeliveries: 50 },
  });
  subscribeOrderEvents(consumer, { repository: store });
  started.push(consumer);
  await consumer.start();
}

function publish(streams: Streams, envelope: EventEnvelope): Promise<void> {
  return new RedisStreamsPublisher(admin.redis, { streamKey: streams.streamKey }).publish(envelope);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error(`kosul ${timeoutMs} ms icinde saglanmadi`);
    }
    await delay(20);
  }
}

/** XINFO GROUPS: her grup duz [ad, deger, ...] dizisidir. */
const groupsInfoSchema = z.array(z.array(z.union([z.string(), z.number(), z.null()])));

/** Order grubunun bilgisi: okunmamis (lag) ve onaylanmamis (pending) kayit sayisi. */
async function orderGroup(streams: Streams): Promise<{ lag: unknown; pending: unknown }> {
  const groups = groupsInfoSchema.parse(await admin.redis.xinfo('GROUPS', streams.streamKey));
  for (const flat of groups) {
    const info = new Map<unknown, unknown>();
    for (let index = 0; index + 1 < flat.length; index += 2) {
      info.set(flat[index], flat[index + 1]);
    }
    if (info.get('name') === EVENT_CONSUMER_GROUP) {
      return { lag: info.get('lag'), pending: info.get('pending') };
    }
  }
  return { lag: undefined, pending: undefined };
}

/** Grup akistaki her kaydi okudu ve onayladi mi? */
async function drained(streams: Streams): Promise<boolean> {
  const { lag, pending } = await orderGroup(streams);
  return lag === 0 && pending === 0;
}

async function statusOf(orderId: string): Promise<string | undefined> {
  return (await store.findById(orderId))?.status;
}

/** Siparisin outbox'taki order.status_changed hedefleri, surum sirasiyla. */
async function statusEvents(orderId: string): Promise<unknown[]> {
  const rows = await connection.db
    .collection(COLLECTIONS.OUTBOX)
    .find({ aggregateId: orderId, topic: EVENTS.ORDER_STATUS_CHANGED })
    .sort({ version: 1 })
    .toArray();
  return rows.map((row) => z.object({ to: z.string() }).parse(row['payload']).to);
}

describe('kurye kilometre taslari uctan uca (Mongo + Redis, T14.3)', () => {
  it('tekrar: ayni paket alindi olayi iki kez gelir, siparis bir kez yola cikar', async () => {
    const streams = freshStreams();
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);
    await startOrderConsumer(streams);
    const event = pickedUpEvent(order, courierId, clock.date());

    await publish(streams, event);
    await publish(streams, event);
    await waitFor(() => drained(streams));

    expect(await statusOf(order.id)).toBe(S.ON_THE_WAY);
    expect((await statusEvents(order.id)).filter((to) => to === S.ON_THE_WAY)).toHaveLength(1);
  });

  it('sirasiz: teslim once gelir (PREPARING -> ON_THE_WAY -> DELIVERED), gec gelen paket alindi yok sayilir', async () => {
    const streams = freshStreams();
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);
    await startOrderConsumer(streams);

    await publish(streams, deliveredEvent(order, courierId, clock.date()));
    await publish(streams, pickedUpEvent(order, courierId, clock.date()));
    await waitFor(() => drained(streams));

    expect(await statusOf(order.id)).toBe(S.DELIVERED);
    expect((await statusEvents(order.id)).slice(-2)).toEqual([S.ON_THE_WAY, S.DELIVERED]);
    expect(await admin.redis.xlen(streams.deadLetterKey)).toBe(0);
  });

  it('iptal edilmis siparis: olaylar onaylanir, siparis CANCELLED kalir', async () => {
    const streams = freshStreams();
    const paid = await insertPaid(store, clock);
    const cancelled = transitionOrder(paid, S.CANCELLED, clock);
    await store.update(cancelled, paid.version, []);
    await startOrderConsumer(streams);
    const courierId = newCourierId();

    await publish(streams, pickedUpEvent(cancelled, courierId, clock.date()));
    await publish(streams, deliveredEvent(cancelled, courierId, clock.date()));
    await waitFor(() => drained(streams));

    expect(await statusOf(cancelled.id)).toBe(S.CANCELLED);
    expect(await admin.redis.xlen(streams.deadLetterKey)).toBe(0);
  });

  it('kuryesi henuz yazilmamis (PAID): olay onaylanmaz, kurye yazilinca yeniden teslimde islenir', async () => {
    const streams = freshStreams();
    const courierId = newCourierId();
    const paid = await insertPaid(store, clock);
    await startOrderConsumer(streams);

    await publish(streams, pickedUpEvent(paid, courierId, clock.date()));
    // Okundu (lag 0) ama onaylanmadi (pending 1): beklemede.
    await waitFor(async () => {
      const { lag, pending } = await orderGroup(streams);
      return lag === 0 && pending === 1;
    });
    expect(await statusOf(paid.id)).toBe(S.PAID);

    await assignCourier(store, paid, courierId, clock);
    await waitFor(async () => (await statusOf(paid.id)) === S.ON_THE_WAY);
    await waitFor(() => drained(streams));

    expect((await statusEvents(paid.id)).slice(-2)).toEqual([S.PREPARING, S.ON_THE_WAY]);
    expect(await admin.redis.xlen(streams.deadLetterKey)).toBe(0);
  });

  it('baska kurye ya da baska market: eski olay, onaylanir, siparis ilerlemez', async () => {
    const streams = freshStreams();
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);
    await startOrderConsumer(streams);

    await publish(streams, deliveredEvent(order, newCourierId(), clock.date()));
    await publish(
      streams,
      pickedUpEvent({ id: order.id, marketId: 'mkt_baska-market' }, courierId, clock.date()),
    );
    await waitFor(() => drained(streams));

    expect(await statusOf(order.id)).toBe(S.PREPARING);
    expect(await admin.redis.xlen(streams.deadLetterKey)).toBe(0);
  });

  it('siparisi olmayan olay olu olaylara gider (reddedildi), kaynak onaylanir', async () => {
    const streams = freshStreams();
    await startOrderConsumer(streams);

    await publish(
      streams,
      deliveredEvent({ id: newId(ID_PREFIX.ORDER) }, newCourierId(), clock.date()),
    );

    await waitFor(async () => (await admin.redis.xlen(streams.deadLetterKey)) === 1);
    const [entry] = await admin.redis.xrange(streams.deadLetterKey, '-', '+');
    const fields = entry?.[1] ?? [];
    const valueOf = (name: string): string | undefined => fields[fields.indexOf(name) + 1];
    expect(valueOf(DEAD_LETTER_FIELD.REASON)).toBe(DEAD_LETTER_REASON.REJECTED);
    expect(valueOf(DEAD_LETTER_FIELD.GROUP)).toBe(EVENT_CONSUMER_GROUP);
    await waitFor(() => drained(streams));
  });
});
