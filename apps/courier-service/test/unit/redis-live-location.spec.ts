/**
 * Canli konumun Redis yazimi (T13.3): yazim hatasi gunluge KONUM tasimaz.
 * ioredis komut hatasi `command.args` icinde degeri (koordinat) tasir; tick bu
 * hatayi WARN olarak yazar. Hata argumansiz AppError'a cevrilir, cause yok.
 * Okuma/yazmanin kendisi entegrasyon testinde (redis-route-motion.spec.ts).
 */

import { ERROR_CODES, fixedClock, isAppError } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import type { RedisConnection } from '@getir/redis-kit';
import { describe, expect, it } from 'vitest';

import { createAdvanceRoute } from '../../src/application/advance-route.js';
import { createAdvanceRoutes } from '../../src/application/advance-routes.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import { ROUTE_STATE } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { InMemoryRouteStore } from '../../src/infrastructure/memory/in-memory-route-store.js';
import { RedisLiveLocationStore } from '../../src/infrastructure/redis/redis-live-location.js';
import {
  courier,
  courierId,
  DELIVERY,
  MARKET,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
  ROUTE_RULE,
} from '../support/couriers.js';
import { RecordingRouteEvents } from '../support/recording-route-events.js';

/** Kuryenin baslangic noktasi. */
const START = northOf(MARKET_LOCATION, 800);
/** Test bolgesinin herhangi bir koordinati (enlem 40.9x, boylam 29.0x); ilerlemis konum da. */
const ANY_COORDINATE = /\b(40\.9|29\.0)\d{2}/;

/** ioredis'in komut hatasi gibi: mesaj sunucunun, argumanlar `command`'da. */
function failingRedis(): RedisConnection['redis'] {
  const set = (...args: unknown[]): Promise<never> =>
    Promise.reject(
      Object.assign(new Error("READONLY You can't write against a read only replica."), {
        name: 'ReplyError',
        command: { name: 'set', args },
      }),
    );
  return { set } as unknown as RedisConnection['redis'];
}

/**
 * pino'nun hata serilestiricisi gibi: hatanin sayilabilir alanlari, mesaji,
 * yigini ve cause'u (ic ice). JSON.stringify yetmez: AppError'in toJSON'u
 * cause'u atlar, gunlukcu ise yazar.
 */
function plain(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return '...';
  }
  const fields = (source: object) =>
    Object.fromEntries(
      Object.entries(source).map(([key, field]) => [key, plain(field, depth + 1)]),
    );
  if (value instanceof Error) {
    return {
      ...fields(value),
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: plain(value.cause, depth + 1),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => plain(item, depth + 1));
  }
  return value !== null && typeof value === 'object' && !(value instanceof Date)
    ? fields(value)
    : value;
}

const serialized = (value: unknown): string => JSON.stringify(plain(value));

describe('RedisLiveLocationStore yazim hatasi', () => {
  it('argumansiz INTERNAL AppError: konum ne ayrintida ne cause ta', async () => {
    const store = new RedisLiveLocationStore(failingRedis(), 30_000);

    const error: unknown = await store
      .save(courierId(1), { location: START, at: new Date(NOW_MS) })
      .catch((caught: unknown) => caught);

    expect(isAppError(error) && error.code).toBe(ERROR_CODES.INTERNAL);
    expect(serialized(error)).toContain('READONLY');
    expect(serialized(error)).not.toMatch(ANY_COORDINATE);
  });

  it('tick turu hatayi WARN yazar; gunluk satirinda koordinat yok', async () => {
    const order = orderId();
    const routes = new InMemoryRouteStore();
    await routes.insertOnce({
      orderId: order,
      courierId: courierId(1),
      ...planRoute({ from: START, pickup: MARKET_LOCATION, dropoff: DELIVERY }, ROUTE_RULE),
      createdAt: new Date(NOW_MS),
      marketId: MARKET,
      state: ROUTE_STATE.MOVING,
    });
    const lines: LogLine[] = [];
    const couriers = new InMemoryCourierStore([
      courier(1, { status: COURIER_STATUS.BUSY, currentOrderId: order }),
    ]);
    const advance = createAdvanceRoutes({
      routes,
      couriers,
      advance: createAdvanceRoute({
        routes,
        couriers,
        events: new RecordingRouteEvents(),
        live: new RedisLiveLocationStore(failingRedis(), 30_000),
        rule: { speedKmh: 36, prepSeconds: 30 },
        clock: fixedClock(NOW_MS + 1_000),
      }),
      batchSize: 10,
    });

    const summary = await advance(recordingLogger(lines));

    expect(summary.failed).toBe(1);
    expect(lines.map((line) => line.level)).toEqual(['warn']);
    expect(serialized(lines)).toContain('canli konum yazilamadi');
    expect(serialized(lines)).not.toMatch(ANY_COORDINATE);
  });
});
