/**
 * Iade komutu uctan uca (T7.4): gercek Mongo + gercek Redis (Testcontainers).
 *
 * Siparis saga'sinin komutu, order'in outbox yayincisiyla ayni yoldan
 * (RedisStreamsPublisher) akisa duser; payment'in tuketicisi main.ts'teki
 * kurulumun aynisidir (RedisStreamsConsumer + subscribePaymentEvents) ve
 * odemeyi Mongo'da iade eder. Her test kendi akisini kullanir.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { ID_PREFIX, newId, systemClock } from '@getir/core';
import {
  DEAD_LETTER_FIELD,
  DEAD_LETTER_REASON,
  RedisStreamsConsumer,
  RedisStreamsPublisher,
} from '@getir/event-bus';
import type { EventEnvelope } from '@getir/event-bus';
import type { MongoConnection } from '@getir/mongo-kit';
import { connectRedis } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { subscribePaymentEvents } from '../../src/bootstrap.js';
import { EVENT_CONSUMER_GROUP } from '../../src/config/constants.js';
import { PAYMENT_STATUS } from '../../src/domain/payment.js';
import type { PaymentMongoStore } from '../../src/infrastructure/mongo/payment-mongo-store.js';
import { chargeOrder } from '../support/charge-order.js';
import { openPaymentStore } from '../support/mongo-payment-service.js';
import { cancelCommand } from '../support/cancel-command.js';
import { refundCommand } from '../support/refund-command.js';

/** infra/docker/docker-compose.dev.yml ile ayni surumler. */
const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const DB_NAME = 'getir_payment_events_test';

let mongoContainer: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
let connection: MongoConnection;
let store: PaymentMongoStore;
let admin: RedisConnection;
const started: RedisStreamsConsumer[] = [];
let streamCounter = 0;

beforeAll(async () => {
  [mongoContainer, redisContainer] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  ({ store, connection } = await openPaymentStore({
    uri: `${mongoContainer.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
  }));
  admin = await connectRedis({
    url: redisContainer.getConnectionUrl(),
    name: 'payment-test-admin',
  });
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
    streamKey: `stream:payment-test-${streamCounter}`,
    deadLetterKey: `stream:payment-test-${streamCounter}:dead`,
  };
}

/** main.ts'teki kurulum; yalnizca sureler kisa ve akis teste ozel. */
async function startPaymentConsumer(streams: Streams): Promise<void> {
  const consumer = new RedisStreamsConsumer({
    connect: () =>
      connectRedis({ url: redisContainer.getConnectionUrl(), name: 'payment-events-test' }),
    consumerName: 'payment-test-1',
    streamKey: streams.streamKey,
    deadLetterKey: streams.deadLetterKey,
    delivery: { blockMs: 50, claimIdleMs: 200, retryDelayMs: 20 },
  });
  subscribePaymentEvents(consumer, { repository: store });
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

/** Payment grubu akistaki her kaydi okudu ve onayladi mi? (lag ve pending sifir) */
async function groupDrained(streams: Streams): Promise<boolean> {
  const groups = groupsInfoSchema.parse(await admin.redis.xinfo('GROUPS', streams.streamKey));
  return groups.some((flat) => {
    const info = new Map<unknown, unknown>();
    for (let index = 0; index + 1 < flat.length; index += 2) {
      info.set(flat[index], flat[index + 1]);
    }
    return (
      info.get('name') === EVENT_CONSUMER_GROUP &&
      info.get('pending') === 0 &&
      info.get('lag') === 0
    );
  });
}

async function statusOf(orderId: string): Promise<string | undefined> {
  return (await store.findByOrderId(orderId))?.status;
}

const chargedOrder = async (): Promise<string> => {
  const orderId = newId(ID_PREFIX.ORDER);
  await chargeOrder({ repository: store, clock: systemClock, orderId, cardToken: 'tok_test_4242' });
  return orderId;
};

describe('payment.refund_requested uctan uca (Mongo + Redis)', () => {
  it('siparis saga sinin komutu odemeyi iade eder; ayni komut tekrar gelirse ikinci iade yok', async () => {
    const streams = freshStreams();
    const orderId = await chargedOrder();
    await startPaymentConsumer(streams);
    const command = refundCommand(orderId, new Date());

    await publish(streams, command);
    await waitFor(async () => (await statusOf(orderId)) === PAYMENT_STATUS.REFUNDED);
    // En az bir kez teslim: ayni zarf ikinci kez akisa duser.
    await publish(streams, command);
    await waitFor(() => groupDrained(streams));

    const payment = await store.findByOrderId(orderId);
    expect(payment?.refundReason).toBe('order_changed_during_payment');
    expect(payment?.attempts.map((attempt) => attempt.kind)).toEqual(['CHARGE', 'REFUND']);
  });

  it('payment kapaliyken birakilan komut acilista islenir (grup akisin basindan okur)', async () => {
    const streams = freshStreams();
    const orderId = await chargedOrder();
    await publish(streams, refundCommand(orderId, new Date()));

    await startPaymentConsumer(streams);

    await waitFor(async () => (await statusOf(orderId)) === PAYMENT_STATUS.REFUNDED);
  });

  it('odemesi olmayan siparisin komutu olu olaylara gider (reddedildi), kaynak onaylanir', async () => {
    const streams = freshStreams();
    await startPaymentConsumer(streams);
    const orderId = newId(ID_PREFIX.ORDER);

    await publish(streams, refundCommand(orderId, new Date()));

    await waitFor(async () => (await admin.redis.xlen(streams.deadLetterKey)) === 1);
    const [entry] = await admin.redis.xrange(streams.deadLetterKey, '-', '+');
    const fields = entry?.[1] ?? [];
    const valueOf = (name: string): string | undefined => fields[fields.indexOf(name) + 1];
    expect(valueOf(DEAD_LETTER_FIELD.REASON)).toBe(DEAD_LETTER_REASON.REJECTED);
    expect(valueOf(DEAD_LETTER_FIELD.GROUP)).toBe(EVENT_CONSUMER_GROUP);
    expect(valueOf(DEAD_LETTER_FIELD.ERROR)).toContain('Odeme bulunamadi');
    await waitFor(() => groupDrained(streams));
  });
});

describe('payment.cancel_requested uctan uca (Mongo + Redis, T11.2 PR 3)', () => {
  it('iptal edilen siparisin kapida odeme kaydi CANCELLED olur; ayni komut tekrar gelirse yazilmaz', async () => {
    const streams = freshStreams();
    const orderId = newId(ID_PREFIX.ORDER);
    await chargeOrder({
      repository: store,
      clock: systemClock,
      orderId,
      cardToken: '',
      cashOnDelivery: true,
    });
    await startPaymentConsumer(streams);
    const command = cancelCommand(orderId, new Date());

    await publish(streams, command);
    await waitFor(async () => (await statusOf(orderId)) === PAYMENT_STATUS.CANCELLED);
    await publish(streams, command);
    await waitFor(() => groupDrained(streams));

    const payment = await store.findByOrderId(orderId);
    expect(payment?.cancelReason).toBe('order_cancelled');
    // Kapida odemede saglayiciya cekim gitmez (deneme yok); tek kayit iptalin.
    expect(payment?.attempts.map((attempt) => attempt.kind)).toEqual(['CANCEL']);
  });

  it('parasi alinmis odemeye dokunulmaz; komut onaylanir (olu olaylara gitmez)', async () => {
    const streams = freshStreams();
    const orderId = await chargedOrder();
    await startPaymentConsumer(streams);

    await publish(streams, cancelCommand(orderId, new Date()));
    await waitFor(() => groupDrained(streams));

    await expect(statusOf(orderId)).resolves.toBe(PAYMENT_STATUS.SUCCEEDED);
    expect(await admin.redis.xlen(streams.deadLetterKey)).toBe(0);
  });
});
