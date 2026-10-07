/**
 * Rota hareketinin altyapisini ACAR (T13.3): tick liderligi, kilometre tasi
 * olaylari ve canli konum. MOCK=true -> bellek (Redis yok): tek ornek hep
 * lider, olaylar YAYINLANMAZ (order da MOCK'ta olay okumaz), canli konum
 * bellekte. Aksi halde Redis: lua/leader.lua, stream:events, courier:{id}:last.
 *
 * Lua script'leri portTAN ONCE yuklenir: lua/ klasoru eksikse servis acilmaz,
 * ilk tick'te patlamaz. Hata olursa acilan Redis baglantisi birakilir.
 */

import { randomUUID } from 'node:crypto';

import type { Logger } from '@getir/core';
import { RedisStreamsPublisher } from '@getir/event-bus';
import type { EventPublisher } from '@getir/event-bus';
import { connectRedis } from '@getir/redis-kit';
import type { RedisEnv } from '@getir/redis-kit';

import { SERVICE_NAME } from '../config/constants.js';
import type { LeaderLock } from '../domain/leader-lock.js';
import type { LiveLocationStore } from '../domain/live-location.js';
import type { RouteEventPublisher } from '../domain/route-events.js';
import { EventBusRouteEvents } from './events/event-bus-route-events.js';
import { InMemoryLeaderLock } from './memory/in-memory-leader-lock.js';
import { InMemoryLiveLocationStore } from './memory/in-memory-live-location.js';
import { LUA_SCRIPTS, loadCourierScripts } from './redis/lua-scripts.js';
import { RedisLeaderLock } from './redis/redis-leader-lock.js';
import { RedisLiveLocationStore } from './redis/redis-live-location.js';

export interface RouteMotion {
  /** Tick liderligi: Redis'te lock:courier-tick, MOCK'ta hep lider. */
  readonly lock: LeaderLock;
  readonly events: RouteEventPublisher;
  readonly live: LiveLocationStore;
  readonly name: 'redis' | 'bellek (MOCK)';
  /** Kapanista tick durduktan SONRA cagrilir. */
  close(): Promise<void>;
}

export interface RouteMotionOptions {
  readonly logger: Logger;
  /** Liderlik kilidinin omru (ms; config/tick-timing.ts). */
  readonly lockTtlMs: number;
  /** Canli konum kaydinin omru (ms; config/tick-timing.ts). */
  readonly liveTtlMs: number;
}

/** MOCK: olay hatti yok; zarf yine semadan gecer (EventBusRouteEvents), sonra atilir. */
const DISCARDING_PUBLISHER: EventPublisher = { publish: () => Promise.resolve() };

export async function openRouteMotion(
  redisEnv: RedisEnv | undefined,
  options: RouteMotionOptions,
): Promise<RouteMotion> {
  if (redisEnv === undefined) {
    return {
      lock: new InMemoryLeaderLock(),
      events: new EventBusRouteEvents(DISCARDING_PUBLISHER),
      live: new InMemoryLiveLocationStore(),
      name: 'bellek (MOCK)',
      close: () => Promise.resolve(),
    };
  }

  const redis = await connectRedis({
    url: redisEnv.REDIS_URL,
    connectTimeoutMs: redisEnv.REDIS_CONNECT_TIMEOUT_MS,
    name: SERVICE_NAME,
    logger: options.logger,
  });
  try {
    const scripts = await loadCourierScripts(redis.redis, options.logger);
    return {
      // Belirtec surec basina tek: kilidi yalnizca bu ornek yeniler ya da birakir.
      lock: new RedisLeaderLock(scripts.get(LUA_SCRIPTS.LEADER), randomUUID(), options.lockTtlMs),
      events: new EventBusRouteEvents(new RedisStreamsPublisher(redis.redis)),
      live: new RedisLiveLocationStore(redis.redis, options.liveTtlMs),
      name: 'redis',
      close: () => redis.close(),
    };
  } catch (error: unknown) {
    await redis.close();
    throw error;
  }
}
