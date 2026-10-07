/**
 * Rota hareketinin Redis altyapisi (T13.3), gercek Redis (Testcontainers):
 *
 *   1. Tick liderligi (lua/leader.lua, lock:courier-tick): ilk alan lider,
 *      yeniler; baskasi alamaz; yalnizca sahibi birakir; omru verilen kadar.
 *   2. Canli konum (courier:{id}:last): yazilir, okunur, TTL'li; bozuk kayit
 *      yok sayilir.
 *   3. openRouteMotion: kilometre tasi olaylari stream:events'e zarfla gider;
 *      order (T14.3) zarfi ve govdeyi sozlesmeyle okur.
 */

import { EVENTS, silentLogger } from '@getir/core';
import { courierDeliveredPayloadSchema } from '@getir/contracts';
import { fromStreamFields } from '@getir/event-bus';
import type { RedisConnection } from '@getir/redis-kit';
import {
  connectRedis,
  COURIER_TICK_LOCK_KEY,
  courierLastKey,
  EVENTS_STREAM_KEY,
} from '@getir/redis-kit';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Route } from '../../src/domain/route.js';
import { LUA_SCRIPTS, loadCourierScripts } from '../../src/infrastructure/redis/lua-scripts.js';
import { RedisLeaderLock } from '../../src/infrastructure/redis/redis-leader-lock.js';
import { RedisLiveLocationStore } from '../../src/infrastructure/redis/redis-live-location.js';
import { openRouteMotion } from '../../src/infrastructure/route-motion.js';
import type { RouteMotion } from '../../src/infrastructure/route-motion.js';
import {
  courierId,
  DELIVERY,
  MARKET,
  MARKET_LOCATION,
  NOW_MS,
  orderId,
} from '../support/couriers.js';

const REDIS_IMAGE = 'redis:7-alpine';
const LOCK_TTL_MS = 3_000;
const LIVE_TTL_MS = 30_000;
/** PTTL okunana kadar gecen sure icin pay. */
const TTL_TOLERANCE_MS = 500;

let container: StartedRedisContainer;
let connection: RedisConnection;
let motion: RouteMotion;
let lockFor: (token: string, ttlMs?: number) => RedisLeaderLock;

beforeAll(async () => {
  container = await new RedisContainer(REDIS_IMAGE).start();
  connection = await connectRedis({ url: container.getConnectionUrl(), name: 'courier-test' });
  const scripts = await loadCourierScripts(connection.redis, silentLogger);
  const leader = scripts.get(LUA_SCRIPTS.LEADER);
  lockFor = (token, ttlMs = LOCK_TTL_MS) => new RedisLeaderLock(leader, token, ttlMs);
  motion = await openRouteMotion(
    { REDIS_URL: container.getConnectionUrl(), REDIS_CONNECT_TIMEOUT_MS: 5_000 },
    { logger: silentLogger, lockTtlMs: LOCK_TTL_MS, liveTtlMs: LIVE_TTL_MS },
  );
});

afterAll(async () => {
  await motion?.close();
  await connection?.close();
  await container?.stop();
});

beforeEach(async () => {
  await connection.redis.flushall();
});

describe('tick liderligi (leader.lua)', () => {
  it('ilk alan lider, yeniler; baskasi alamaz; yalnizca sahibi birakir; omru verilen kadar', async () => {
    const a = lockFor('ornek-a');
    const b = lockFor('ornek-b');

    expect(await a.hold()).toBe(true);
    expect(await b.hold()).toBe(false);
    expect(await a.hold()).toBe(true);
    const ttl = await connection.redis.pttl(COURIER_TICK_LOCK_KEY);
    expect(ttl).toBeGreaterThan(LOCK_TTL_MS - TTL_TOLERANCE_MS);
    expect(ttl).toBeLessThanOrEqual(LOCK_TTL_MS);

    await b.release();
    expect(await connection.redis.get(COURIER_TICK_LOCK_KEY)).toBe('ornek-a');
    await a.release();
    expect(await b.hold()).toBe(true);
  });

  it('lider duserse (yenilemezse) kilit omru dolunca baska ornek devralir', async () => {
    const a = lockFor('ornek-a', 300);
    const b = lockFor('ornek-b', 300);

    expect(await a.hold()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(await b.hold()).toBe(true);
    expect(await a.hold()).toBe(false);
  });

  it('openRouteMotion kilidi ayni anahtari kullanir (surec basina rastgele belirtec)', async () => {
    expect(await motion.lock.hold()).toBe(true);
    expect(await lockFor('ornek-baska').hold()).toBe(false);

    await motion.lock.release();
    expect(await connection.redis.exists(COURIER_TICK_LOCK_KEY)).toBe(0);
  });
});

describe('canli konum (courier:{id}:last)', () => {
  const at = new Date(NOW_MS);

  it('yazilir ve okunur; anahtar TTL li (kurye durunca duser)', async () => {
    const id = courierId(1);
    await motion.live.save(id, { location: MARKET_LOCATION, at });

    expect(await motion.live.find(id)).toEqual({ location: MARKET_LOCATION, at });
    const ttl = await connection.redis.pttl(courierLastKey(id));
    expect(ttl).toBeGreaterThan(LIVE_TTL_MS - TTL_TOLERANCE_MS);
    expect(ttl).toBeLessThanOrEqual(LIVE_TTL_MS);
  });

  it('kayit yoksa, suresi dolduysa ya da bozuksa null', async () => {
    const store = new RedisLiveLocationStore(connection.redis, 100);
    await store.save(courierId(2), { location: DELIVERY, at });
    await connection.redis.set(courierLastKey(courierId(3)), '{"lat":"kirk"}', 'PX', 10_000);
    await connection.redis.set(courierLastKey(courierId(4)), 'json-degil', 'PX', 10_000);
    await new Promise((resolve) => setTimeout(resolve, 200));

    for (const order of [2, 3, 4, 5]) {
      expect(await store.find(courierId(order))).toBeNull();
    }
  });
});

describe('kilometre tasi olaylari (stream:events)', () => {
  it('courier.delivered zarfla hatta: konu, bolum anahtari siparis, an teslim ani, govde sozlesmeden', async () => {
    const route: Route = {
      orderId: orderId(),
      courierId: courierId(1),
      points: [MARKET_LOCATION, DELIVERY],
      pickupIndex: 0,
      distanceMeters: 0,
      etaSeconds: 0,
      createdAt: new Date(NOW_MS),
      marketId: MARKET,
    };
    const deliveredAt = new Date(NOW_MS + 300_000);

    await motion.events.delivered(route, deliveredAt);

    const entries = await connection.redis.xrange(EVENTS_STREAM_KEY, '-', '+');
    expect(entries).toHaveLength(1);
    const envelope = fromStreamFields(entries[0]?.[1] ?? []);
    expect(envelope).toMatchObject({
      topic: EVENTS.COURIER_DELIVERED,
      partitionKey: route.orderId,
      occurredAt: deliveredAt.toISOString(),
    });
    expect(courierDeliveredPayloadSchema.parse(envelope.payload)).toMatchObject({
      orderId: route.orderId,
      courierId: route.courierId,
    });
    // Koordinat olay govdesinde yok (asama 1): kisisel veri hatta yazilmaz.
    expect(JSON.stringify(entries)).not.toContain(String(DELIVERY.lat));
  });
});
