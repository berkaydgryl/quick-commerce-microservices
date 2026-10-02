/**
 * Stok yarisi (T11.1, roadmap "Garantiler ve nasil kanitlanir"): ayni anda 100
 * rezervasyon, stok 1 -> tam 1 basari, 99 STOCK_INSUFFICIENT.
 *
 * Gercek inventory gRPC sunucusu ve gercek Redis (Testcontainers). Yaris urunu
 * demo stogundan gelir: Migros Jet Moda cikolata, 1 adet (stock-levels.ts).
 * Yarisanlar 100 FARKLI kullanicidir: ayni kullanicinin ikinci istegi zaten
 * RESERVATION_ACTIVE alir (B22), yaris stok icin olmaz.
 *
 * Kontrol deneyi: ayni yuk, kilitsiz bir rezervasyonla (once oku, sonra dus;
 * iki ayri komut) birden fazla basari verir. Yani "tam 1 basari" tesadufi
 * degil: senaryo gercekten es zamanlilik uretiyor, garantiyi reserve.lua'nin
 * atomikligi sagliyor.
 *
 *   pnpm race   (yalnizca bu dosya; Docker gerekir)
 */

import { ERROR_CODES, GRPC_STATUS, silentLogger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { inventoryV1 } from '@getir/proto';
import type { RedisConnection } from '@getir/redis-kit';
import {
  connectRedis,
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
  userReservationKey,
} from '@getir/redis-kit';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildInventoryService } from '../../src/bootstrap.js';
import {
  LUA_SCRIPTS,
  RESERVATION_HOLD_AFTER_EXPIRY_MS,
  SETTLED_RESERVATION_TTL_MS,
} from '../../src/config/constants.js';
import { STOCK_LEVELS } from '../../src/infrastructure/fixtures/stock-levels.js';
import { InMemoryStockCommitter } from '../../src/infrastructure/memory/in-memory-stock-committer.js';
import { InMemoryStockLedger } from '../../src/infrastructure/memory/in-memory-stock-ledger.js';
import { loadInventoryScripts } from '../../src/infrastructure/redis/lua-scripts.js';
import { RedisReservationStore } from '../../src/infrastructure/redis/redis-reservation-store.js';
import { RedisStockCounters } from '../../src/infrastructure/redis/redis-stock-counters.js';
import { orderId, userId } from '../support/reservation-store-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const REDIS_IMAGE = 'redis:7-alpine';
const CONTENDERS = 100;
const RACE_MARKET = 'mkt_migros-jet-moda';
const RACE_SKU = 'CIKOLATA-80';
const service = inventoryV1.InventoryServiceService;
const { RESERVATION_OUTCOME_APPLIED } = inventoryV1.ReservationOutcome;

const RACE_STOCK = STOCK_LEVELS.find(
  (level) => level.marketId === RACE_MARKET && level.sku === RACE_SKU,
);

/** Bir inventory sureci: kendi Redis baglantisi, kendi script'leri, kendi gRPC sunucusu. */
interface InventoryNode {
  readonly server: TestGrpcServer;
  readonly redis: RedisConnection;
  /** Sunucunun gunlugu (#49: is sonucu info, siradisi warn, beklenmeyen error). */
  readonly lines: LogLine[];
  close(): Promise<void>;
}

let container: StartedRedisContainer;
/** Yalnizca test kurulumu ve denetimi: sayaci yazar, anahtarlara bakar. */
let admin: RedisConnection;
const nodes: InventoryNode[] = [];

async function startNode(name: string): Promise<InventoryNode> {
  const redis = await connectRedis({ url: container.getConnectionUrl(), name });
  const scripts = await loadInventoryScripts(redis.redis, silentLogger);
  const reservations = new RedisReservationStore(
    redis.redis,
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
  const ledger = new InMemoryStockLedger();
  const lines: LogLine[] = [];
  const logger = recordingLogger(lines);
  const server = await startTestGrpcServer({
    serviceName: name,
    logger,
    services: [
      buildInventoryService({
        logger,
        stock: {
          counters: new RedisStockCounters(redis.redis, silentLogger),
          reservations,
          ledger,
          committer: new InMemoryStockCommitter([], ledger),
          recoverCounters: () => Promise.resolve(false),
        },
      }),
    ],
  });
  const node: InventoryNode = {
    server,
    redis,
    lines,
    close: async () => {
      await server.stop();
      await redis.close();
    },
  };
  nodes.push(node);
  return node;
}

/** Redis'i bosaltir ve yaris urununun sayacini demo stogundan (1 adet) yazar. */
async function seedRaceStock(): Promise<void> {
  if (RACE_STOCK === undefined) {
    throw new Error('demo stogunda yaris urunu yok');
  }
  await admin.redis.flushall();
  await new RedisStockCounters(admin.redis, silentLogger).write([RACE_STOCK], 'overwrite');
}

const reserveRequest = (contender: number) =>
  inventoryV1.ReserveRequest.fromPartial({
    orderId: orderId(contender),
    marketId: RACE_MARKET,
    userId: userId(contender),
    items: [{ sku: RACE_SKU, quantity: 1 }],
    ttlSeconds: 600,
  });

/** 100 yarisci ayni anda; istekler sunuculara sirayla dagitilir. */
async function race(over: readonly InventoryNode[]) {
  const results = await Promise.all(
    Array.from({ length: CONTENDERS }, async (_, index) => {
      const contender = index + 1;
      const node = over[index % over.length];
      if (node === undefined) {
        throw new Error('sunucu yok');
      }
      return { contender, ...(await node.server.call(service.reserve, reserveRequest(contender))) };
    }),
  );
  return {
    winners: results.filter((result) => result.error === undefined),
    losers: results.filter((result) => result.error !== undefined),
  };
}

/** Yaristan sonra Redis: sayac, indeks, rezervasyon kayitlari ve kullanici kilitleri. */
async function raceState() {
  const contenders = Array.from({ length: CONTENDERS }, (_, index) => index + 1);
  const exists = async (key: string) => (await admin.redis.exists(key)) === 1;
  const withReservation: number[] = [];
  const withUserLock: number[] = [];
  for (const contender of contenders) {
    if (await exists(reservationKey(RACE_MARKET, orderId(contender)))) {
      withReservation.push(contender);
    }
    if (await exists(userReservationKey(userId(contender)))) {
      withUserLock.push(contender);
    }
  }
  return {
    available: await admin.redis.get(stockAvailKey(RACE_MARKET, RACE_SKU)),
    indexMembers: await admin.redis.zrange(reservationIndexKey(RACE_MARKET), '0', '-1'),
    withReservation,
    withUserLock,
  };
}

beforeAll(async () => {
  container = await new RedisContainer(REDIS_IMAGE).start();
  admin = await connectRedis({ url: container.getConnectionUrl(), name: 'inventory-race-admin' });
});

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.close()));
});

afterAll(async () => {
  await admin?.close();
  await container?.stop();
});

describe('stok yarisi (T11.1): 100 es zamanli rezervasyon, stok 1', () => {
  it('yaris urunu demo stogunda tek adet (Migros Jet Moda cikolata)', () => {
    expect(RACE_STOCK?.onHand).toBe(1);
  });

  it('tek sunucu: tam 1 basari, 99 STOCK_INSUFFICIENT; kaybedenler hicbir iz birakmaz', async () => {
    await seedRaceStock();
    const node = await startNode('inventory-race-1');

    const { winners, losers } = await race([node]);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(CONTENDERS - 1);
    for (const loser of losers) {
      expect(loser.error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
      expect(appErrorOf(loser.error)).toMatchObject({
        code: ERROR_CODES.STOCK_INSUFFICIENT,
        details: { sku: RACE_SKU, requested: 1, available: 0 },
      });
    }
    const winner = winners[0]?.contender;
    expect(await raceState()).toEqual({
      available: '0',
      indexMembers: [orderId(winner ?? 0)],
      withReservation: [winner],
      withUserLock: [winner],
    });
  });

  it('kaybedenlerin her biri is sonucu olarak info yazilir; uyari ya da hata satiri yok (#49)', async () => {
    await seedRaceStock();
    const node = await startNode('inventory-race-log');

    await race([node]);

    const outcomes = node.lines.filter((line) => line.message === 'rpc is hatasiyla dondu');
    expect(outcomes).toHaveLength(CONTENDERS - 1);
    expect(outcomes.every((line) => line.level === 'info')).toBe(true);
    expect(node.lines.filter((line) => line.level === 'warn' || line.level === 'error')).toEqual(
      [],
    );
  });

  it('ayni Redis e bagli iki sunucu (yatay olcek): yine tam 1 basari', async () => {
    await seedRaceStock();
    const first = await startNode('inventory-race-a');
    const second = await startNode('inventory-race-b');

    const { winners, losers } = await race([first, second]);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(CONTENDERS - 1);
    expect(
      losers.every((loser) => appErrorOf(loser.error)?.code === ERROR_CODES.STOCK_INSUFFICIENT),
    ).toBe(true);
    // Iki sunucu da yaristi: her birine 50 istek gitti, kaybedenler ikisinden de.
    expect(new Set(losers.map((loser) => loser.contender % 2))).toEqual(new Set([0, 1]));
    expect((await raceState()).available).toBe('0');
    expect((await raceState()).indexMembers).toHaveLength(1);
  });

  it('kazanan birakinca stok 1 e doner; kaybedenlerden biri artik alir', async () => {
    await seedRaceStock();
    const node = await startNode('inventory-race-release');
    const { winners, losers } = await race([node]);
    const winner = winners[0]?.contender ?? 0;
    const late = losers[0]?.contender ?? 0;

    const released = await node.server.call(
      service.release,
      inventoryV1.ReleaseRequest.fromPartial({
        orderId: orderId(winner),
        marketId: RACE_MARKET,
        reason: 'user_cancelled',
      }),
    );

    expect(released.response).toEqual({ outcome: RESERVATION_OUTCOME_APPLIED });
    expect((await raceState()).available).toBe('1');
    const retried = await node.server.call(service.reserve, reserveRequest(late));
    expect(retried.error).toBeUndefined();
    expect((await raceState()).available).toBe('0');
  });
});

describe('kontrol deneyi: kilitsiz rezervasyon ayni yukte birden fazla basari verir', () => {
  /**
   * Kilitsiz rezervasyon: once oku, sonra dus (iki ayri komut). reserve.lua'nin
   * yaptigini atomik OLMADAN yapar; okuma ile dusum arasina baska istek girer.
   */
  async function reserveWithoutLock(redis: RedisConnection): Promise<boolean> {
    const key = stockAvailKey(RACE_MARKET, RACE_SKU);
    const available = Number(await redis.redis.get(key));
    if (available < 1) {
      return false;
    }
    await redis.redis.decrby(key, 1);
    return true;
  }

  it('ayni 100 es zamanli istek, iki baglanti: birden fazla basari ve eksiye dusen sayac (fazla satis)', async () => {
    await seedRaceStock();
    const first = await connectRedis({ url: container.getConnectionUrl(), name: 'race-control-a' });
    const second = await connectRedis({
      url: container.getConnectionUrl(),
      name: 'race-control-b',
    });
    try {
      const outcomes = await Promise.all(
        Array.from({ length: CONTENDERS }, (_, index) =>
          reserveWithoutLock(index % 2 === 0 ? first : second),
        ),
      );

      expect(outcomes.filter(Boolean).length).toBeGreaterThan(1);
      expect(Number(await admin.redis.get(stockAvailKey(RACE_MARKET, RACE_SKU)))).toBeLessThan(0);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
