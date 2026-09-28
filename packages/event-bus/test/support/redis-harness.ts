/**
 * Tuketici entegrasyon testlerinin Redis duzenegi (Testcontainers): konteyner,
 * yonetici baglantisi, test basina AYRI akis (gruplar ve bekleyen kayitlar
 * testler arasi sizmaz), tuketici kurma ve inceleme yardimcilari. Kancalar
 * (beforeAll / afterEach / afterAll) useRedisHarness'i cagiran dosyada kurulur.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { EVENTS, ID_PREFIX, newId } from '@getir/core';
import { connectRedis } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll } from 'vitest';

import type { DeliverySettings } from '../../src/delivery-settings.js';
import type { EventEnvelope } from '../../src/envelope.js';
import { RedisStreamsConsumer } from '../../src/redis-streams-consumer.js';
import { RedisStreamsPublisher } from '../../src/redis-streams-publisher.js';
import { EVENT_HANDLED } from '../../src/subscriber.js';
import type { EventHandler } from '../../src/subscriber.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const REDIS_IMAGE = 'redis:7-alpine';

export const GROUP = 'payment';

/** Uretim degerleri delivery-settings.ts'te; testte takilma 150 ms. */
export const FAST_DELIVERY: Partial<DeliverySettings> = {
  blockMs: 50,
  claimIdleMs: 150,
  retryDelayMs: 20,
  maxDeliveries: 3,
};

export interface Streams {
  readonly streamKey: string;
  readonly deadLetterKey: string;
}

export interface RedisHarness {
  /** Yayin ve inceleme icin yonetici baglantisi. */
  admin(): RedisConnection;
  freshStreams(): Streams;
  consumerOn(
    streams: Streams,
    name?: string,
    delivery?: Partial<DeliverySettings>,
  ): RedisStreamsConsumer;
  /** Baslatir; dosyanin afterEach'i durdurur. */
  startAll(...consumers: RedisStreamsConsumer[]): Promise<void>;
  publish(streams: Streams, envelope: EventEnvelope): Promise<void>;
  /** Grubun onaylanmamis kayit sayisi (XPENDING ozet bicimi: [sayi, ...]). */
  pendingCount(streams: Streams, group?: string): Promise<unknown>;
  deadLetters(streams: Streams): Promise<Map<string, string>[]>;
}

export function useRedisHarness(): RedisHarness {
  let container: StartedRedisContainer | undefined;
  let admin: RedisConnection | undefined;
  const started: RedisStreamsConsumer[] = [];
  let streamCounter = 0;

  beforeAll(async () => {
    container = await new RedisContainer(REDIS_IMAGE).start();
    admin = await connectRedis({ url: container.getConnectionUrl(), name: 'event-bus-admin' });
  });

  afterEach(async () => {
    await Promise.all(started.splice(0).map((consumer) => consumer.stop()));
  });

  afterAll(async () => {
    await admin?.close();
    await container?.stop();
  });

  const url = (): string => {
    if (container === undefined) {
      throw new Error('Redis konteyneri henuz baslamadi');
    }
    return container.getConnectionUrl();
  };
  const adminConnection = (): RedisConnection => {
    if (admin === undefined) {
      throw new Error('Redis yonetici baglantisi henuz acilmadi');
    }
    return admin;
  };

  return {
    admin: adminConnection,
    freshStreams: () => {
      streamCounter += 1;
      return {
        streamKey: `stream:test-${streamCounter}`,
        deadLetterKey: `stream:test-${streamCounter}:dead`,
      };
    },
    consumerOn: (streams, name = 'tuketici-1', delivery = FAST_DELIVERY) =>
      new RedisStreamsConsumer({
        connect: () => connectRedis({ url: url(), name }),
        consumerName: name,
        streamKey: streams.streamKey,
        deadLetterKey: streams.deadLetterKey,
        delivery,
      }),
    startAll: async (...consumers) => {
      for (const consumer of consumers) {
        started.push(consumer);
        await consumer.start();
      }
    },
    publish: (streams, envelope) =>
      new RedisStreamsPublisher(adminConnection().redis, { streamKey: streams.streamKey }).publish(
        envelope,
      ),
    pendingCount: async (streams, group = GROUP) => {
      const [count] = await adminConnection().redis.xpending(streams.streamKey, group);
      return count;
    },
    deadLetters: async (streams) => {
      const entries = await adminConnection().redis.xrange(streams.deadLetterKey, '-', '+');
      return entries.map(([, fields]) => {
        const values = new Map<string, string>();
        for (let index = 0; index + 1 < fields.length; index += 2) {
          values.set(fields[index] ?? '', fields[index + 1] ?? '');
        }
        return values;
      });
    },
  };
}

export function refundCommand(orderId = newId(ID_PREFIX.ORDER)): EventEnvelope {
  return {
    eventId: newId(ID_PREFIX.EVENT),
    topic: EVENTS.PAYMENT_REFUND_REQUESTED,
    partitionKey: orderId,
    occurredAt: new Date().toISOString(),
    payload: { orderId },
  };
}

export function orderCreated(): EventEnvelope {
  return { ...refundCommand(), topic: EVENTS.ORDER_CREATED };
}

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error(`kosul ${timeoutMs} ms icinde saglanmadi`);
    }
    await delay(20);
  }
}

/** Gelen zarflari ve deneme siralarini kaydeden isleyici. */
export function recorder(received: EventEnvelope[], attempts: number[] = []): EventHandler {
  return (envelope, delivery) => {
    received.push(envelope);
    attempts.push(delivery.attempt);
    return Promise.resolve(EVENT_HANDLED);
  };
}
