/**
 * Uzatmada beklenen bitis, gercek Redis (extend.lua; T15.3, bekleyen is 117,
 * QA IQ3; Testcontainers). Bellekteki ikiziyle ayni sozlesme
 * (test/support/reservation-extend-expected-contract.ts) ve sahte istemciyle
 * dogrulanamayanlar:
 *   1. Uyusmazlik HICBIR sey yazmaz: hash alanlari ve omru, indeks skoru,
 *      kullanici kilidinin omru degismez.
 *   2. Denetim indeks SKORUNA karsidir (supurucunun ve 'due' denetiminin
 *      kullandigi deger); hash'teki expiresAt alani karar vermez.
 */

import { silentLogger, systemClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { RedisConnection } from '@getir/redis-kit';
import {
  connectRedis,
  reservationIndexKey,
  reservationKey,
  userReservationKey,
} from '@getir/redis-kit';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  LUA_SCRIPTS,
  RESERVATION_HOLD_AFTER_EXPIRY_MS,
  SETTLED_RESERVATION_TTL_MS,
} from '../../src/config/constants.js';
import { loadInventoryScripts } from '../../src/infrastructure/redis/lua-scripts.js';
import { RedisReservationStore } from '../../src/infrastructure/redis/redis-reservation-store.js';
import { RedisStockCounters } from '../../src/infrastructure/redis/redis-stock-counters.js';
import { describeExtendExpectedContract } from '../support/reservation-extend-expected-contract.js';
import { MARKET, orderId, userId } from '../support/reservation-store-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const REDIS_IMAGE = 'redis:7-alpine';
const TTL_MS = 600_000;
const ADD_MS = 60_000;

let container: StartedRedisContainer;
let connection: RedisConnection;
let counters: RedisStockCounters;
let reservations: RedisReservationStore;

beforeAll(async () => {
  container = await new RedisContainer(REDIS_IMAGE).start();
  connection = await connectRedis({
    url: container.getConnectionUrl(),
    name: 'inventory-extend-expected-test',
  });
  counters = new RedisStockCounters(connection.redis, silentLogger);
  const scripts = await loadInventoryScripts(connection.redis, recordingLogger([]));
  reservations = new RedisReservationStore(
    connection.redis,
    {
      reserve: scripts.get(LUA_SCRIPTS.RESERVE),
      release: scripts.get(LUA_SCRIPTS.RELEASE),
      commit: scripts.get(LUA_SCRIPTS.COMMIT),
      extend: scripts.get(LUA_SCRIPTS.EXTEND),
      shorten: scripts.get(LUA_SCRIPTS.SHORTEN),
    },
    {
      holdAfterExpiryMs: RESERVATION_HOLD_AFTER_EXPIRY_MS,
      settledTtlMs: SETTLED_RESERVATION_TTL_MS,
    },
  );
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describeExtendExpectedContract('redis', async () => {
  await connection.redis.flushall();
  return { counters, reservations };
});

describe('uzatmada beklenen bitis: Redis anahtarlari (T15.3)', () => {
  const resvKey = reservationKey(MARKET, orderId(1));
  let nowMs: number;

  beforeEach(async () => {
    await connection.redis.flushall();
    await counters.write([{ marketId: MARKET, sku: 'SUT-1L', onHand: 5 }], 'overwrite');
    nowMs = systemClock.now();
    await reservations.reserve({
      orderId: orderId(1),
      userId: userId(1),
      marketId: MARKET,
      lines: [{ sku: 'SUT-1L', quantity: 1 }],
      nowMs,
      ttlMs: TTL_MS,
    });
  });

  const extend = (expectedExpiresAt: number) =>
    reservations.extend({
      orderId: orderId(1),
      marketId: MARKET,
      nowMs,
      additionalMs: ADD_MS,
      maxExtensions: 3,
      expectedExpiresAt,
    });
  const snapshot = async () => ({
    fields: await connection.redis.hgetall(resvKey),
    score: await connection.redis.zscore(reservationIndexKey(MARKET), orderId(1)),
    hashTtl: await connection.redis.pttl(resvKey),
    userTtl: await connection.redis.pttl(userReservationKey(userId(1))),
  });

  it('uyusmazlik HICBIR sey yazmaz: alanlar, skor ayni; omurler yenilenmez', async () => {
    const before = await snapshot();

    expect((await extend(nowMs + TTL_MS + 1)).status).toBe('expiry-mismatch');

    const after = await snapshot();
    expect(after.fields).toEqual(before.fields);
    expect(after.score).toBe(before.score);
    expect(after.hashTtl).toBeLessThanOrEqual(before.hashTtl);
    expect(after.userTtl).toBeLessThanOrEqual(before.userTtl);
  });

  it("denetim indeks skoruna karsidir; hash'teki expiresAt alani karar vermez", async () => {
    const reservedUntil = nowMs + TTL_MS;
    await connection.redis.hset(resvKey, 'expiresAt', String(reservedUntil + 12_345));

    expect((await extend(reservedUntil + 12_345)).status).toBe('expiry-mismatch');
    expect(await extend(reservedUntil)).toMatchObject({
      status: 'extended',
      expiresAt: reservedUntil + ADD_MS,
    });
  });
});
