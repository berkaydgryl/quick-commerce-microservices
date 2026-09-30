/**
 * Rezervasyonun gercek Redis uygulamasi (reserve.lua, T10.1; Testcontainers).
 *
 * Sahte istemciyle dogrulanamayan seyler burada sinanir:
 *   1. Bellektekiyle AYNI sozlesme (test/support/reservation-store-contract.ts).
 *   2. Anahtar duzeni (B15, B23): hash alanlari, sureler, indeks, kullanici kilidi.
 *   3. Basarisiz denemede Redis'e HICBIR anahtar yazilmaz (kismi rezervasyon yok).
 *   4. Es zamanli istekler: son kutuyu tek istek alir; ayni kullanicinin es
 *      zamanli iki siparisinden yalniz biri acilir. (100 paralel yaris T11.1'de.)
 *   5. NOSCRIPT sonrasi toparlanma; bozuk ve negatif sayac.
 *   6. Kullanici kilidi ayri slot'ta: beyan edildigi icin cagri basina uyari yok.
 *   7. Gercek gRPC uzerinden: STOCK_INSUFFICIENT ayrintisi, dusumun musaitlikte gorunmesi.
 *   8. Birakma (release.lua, T10.2): iz, sahiplik yarisi, bozuk / eksik sayac,
 *      kaydi dusmus indeks uyesi, eskimis on okuma.
 */

import { ERROR_CODES, GRPC_STATUS, silentLogger, systemClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { inventoryV1 } from '@getir/proto';
import type { LuaScript, RedisConnection } from '@getir/redis-kit';
import {
  connectRedis,
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
  userReservationKey,
} from '@getir/redis-kit';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildInventoryService } from '../../src/bootstrap.js';
import {
  LUA_SCRIPTS,
  RESERVATION_HOLD_AFTER_EXPIRY_MS,
  SETTLED_RESERVATION_TTL_MS,
} from '../../src/config/constants.js';
import type { ReservationLine } from '../../src/domain/reservation.js';
import { InMemoryStockLedger } from '../../src/infrastructure/memory/in-memory-stock-ledger.js';
import { loadInventoryScripts } from '../../src/infrastructure/redis/lua-scripts.js';
import { RedisReservationStore } from '../../src/infrastructure/redis/redis-reservation-store.js';
import { RedisStockCounters } from '../../src/infrastructure/redis/redis-stock-counters.js';
import {
  describeReservationStoreContract,
  MARKET,
  orderId,
  userId,
} from '../support/reservation-store-contract.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const REDIS_IMAGE = 'redis:7-alpine';
const TTL_MS = 600_000;
/** Olculen TTL'in komuttan sonra gecen sure kadar eksik okunmasina pay. */
const TTL_TOLERANCE_MS = 2_000;

let container: StartedRedisContainer;
let connection: RedisConnection;
let counters: RedisStockCounters;
let reservations: RedisReservationStore;
let releaseScript: LuaScript;
const loadLines: LogLine[] = [];

beforeAll(async () => {
  container = await new RedisContainer(REDIS_IMAGE).start();
  connection = await connectRedis({
    url: container.getConnectionUrl(),
    name: 'inventory-resv-test',
  });
  counters = new RedisStockCounters(connection.redis, silentLogger);
  const scripts = await loadInventoryScripts(connection.redis, recordingLogger(loadLines));
  releaseScript = scripts.get(LUA_SCRIPTS.RELEASE);
  reservations = new RedisReservationStore(
    connection.redis,
    { reserve: scripts.get(LUA_SCRIPTS.RESERVE), release: scripts.get(LUA_SCRIPTS.RELEASE) },
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

describeReservationStoreContract('redis', async () => {
  await connection.redis.flushall();
  return { counters, reservations };
});

async function seed(levels: Record<string, number>): Promise<void> {
  await connection.redis.flushall();
  await counters.write(
    Object.entries(levels).map(([sku, onHand]) => ({ marketId: MARKET, sku, onHand })),
    'overwrite',
  );
}

const reserve = (
  order: number,
  user: number,
  lines: readonly ReservationLine[],
  nowMs = systemClock.now(),
) =>
  reservations.reserve({
    orderId: orderId(order),
    userId: userId(user),
    marketId: MARKET,
    lines,
    nowMs,
    ttlMs: TTL_MS,
  });

describe('anahtar duzeni (B15, B22, B23)', () => {
  beforeEach(() => seed({ 'SUT-1L': 5, 'KOLA-1L': 3 }));

  it('hash: qty:{sku} alanlari + kimlik ve sure; sure + pay kadar yasar', async () => {
    const nowMs = systemClock.now();
    await reserve(
      1,
      1,
      [
        { sku: 'SUT-1L', quantity: 2 },
        { sku: 'KOLA-1L', quantity: 1 },
      ],
      nowMs,
    );

    const key = reservationKey(MARKET, orderId(1));
    expect(await connection.redis.hgetall(key)).toEqual({
      'qty:SUT-1L': '2',
      'qty:KOLA-1L': '1',
      orderId: orderId(1),
      userId: userId(1),
      marketId: MARKET,
      reservedAt: String(nowMs),
      expiresAt: String(nowMs + TTL_MS),
      extended: '0',
    });
    const ttl = await connection.redis.pttl(key);
    expect(ttl).toBeGreaterThan(TTL_MS + RESERVATION_HOLD_AFTER_EXPIRY_MS - TTL_TOLERANCE_MS);
    expect(ttl).toBeLessThanOrEqual(TTL_MS + RESERVATION_HOLD_AFTER_EXPIRY_MS);
  });

  it('sure indeksi: uye siparis, skor bitis ani (supurucu bundan okur, T10.3)', async () => {
    const nowMs = systemClock.now();
    await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }], nowMs);

    expect(await connection.redis.zscore(reservationIndexKey(MARKET), orderId(1))).toBe(
      String(nowMs + TTL_MS),
    );
    // Indeks TTL'sizdir (ADR-03): kayit silinse de supurucu indeksi okuyabilmeli.
    expect(await connection.redis.pttl(reservationIndexKey(MARKET))).toBe(-1);
  });

  it('kullanici kilidi: deger siparis, rezervasyonun suresi kadar yasar', async () => {
    await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }]);

    const key = userReservationKey(userId(1));
    expect(await connection.redis.get(key)).toBe(orderId(1));
    const ttl = await connection.redis.pttl(key);
    expect(ttl).toBeGreaterThan(TTL_MS - TTL_TOLERANCE_MS);
    expect(ttl).toBeLessThanOrEqual(TTL_MS);
  });

  it('basarisiz rezervasyon Redis e HICBIR anahtar yazmaz, sayaclara dokunmaz', async () => {
    const before = await connection.redis.dbsize();

    const outcome = await reserve(1, 1, [
      { sku: 'SUT-1L', quantity: 1 },
      { sku: 'KOLA-1L', quantity: 4 },
    ]);

    expect(outcome.status).toBe('insufficient');
    expect(await connection.redis.dbsize()).toBe(before);
    expect(await connection.redis.exists(reservationKey(MARKET, orderId(1)))).toBe(0);
    expect(await connection.redis.exists(reservationIndexKey(MARKET))).toBe(0);
    expect(await connection.redis.exists(userReservationKey(userId(1)))).toBe(0);
    expect(
      await connection.redis.mget(
        stockAvailKey(MARKET, 'SUT-1L'),
        stockAvailKey(MARKET, 'KOLA-1L'),
      ),
    ).toEqual(['5', '3']);
  });
});

describe('es zamanli istekler', () => {
  it('son kutu: 30 farkli kullanici ayni anda isterse tam biri alir', async () => {
    await seed({ 'CIKOLATA-80': 1 });

    const outcomes = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        reserve(index + 1, index + 1, [{ sku: 'CIKOLATA-80', quantity: 1 }]),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.status === 'reserved')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'insufficient')).toHaveLength(29);
    expect(await connection.redis.get(stockAvailKey(MARKET, 'CIKOLATA-80'))).toBe('0');
    expect(await connection.redis.zcard(reservationIndexKey(MARKET))).toBe(1);
  });

  it('ayni kullanicinin es zamanli 10 siparisinden yalniz biri acilir; stok bir kez duser', async () => {
    await seed({ 'SUT-1L': 50 });

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        reserve(index + 1, 7, [{ sku: 'SUT-1L', quantity: 2 }]),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.status === 'reserved')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'user-has-active')).toHaveLength(9);
    expect(await connection.redis.get(stockAvailKey(MARKET, 'SUT-1L'))).toBe('48');
  });
});

describe('dayaniklilik', () => {
  it('SCRIPT FLUSH sonrasi (Redis yeniden baslamis gibi) rezervasyon calisir', async () => {
    await seed({ 'SUT-1L': 5 });
    await connection.redis.script('FLUSH');

    expect((await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }])).status).toBe('reserved');
  });

  it('tam sayi olmayan sayac INTERNAL; oncesindeki kalem de DUSMEZ (kismi yok)', async () => {
    await seed({ 'SUT-1L': 5 });
    await connection.redis.set(stockAvailKey(MARKET, 'KOLA-1L'), '3.5');

    await expect(
      reserve(1, 1, [
        { sku: 'SUT-1L', quantity: 1 },
        { sku: 'KOLA-1L', quantity: 1 },
      ]),
    ).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL });
    expect(await connection.redis.get(stockAvailKey(MARKET, 'SUT-1L'))).toBe('5');
    expect(await connection.redis.exists(reservationKey(MARKET, orderId(1)))).toBe(0);
  });

  it('negatif sayac (fazla satis izi) yetersizdir; deger oldugu gibi bildirilir', async () => {
    await seed({ 'SUT-1L': 5 });
    await connection.redis.set(stockAvailKey(MARKET, 'SUT-1L'), '-3');

    expect(await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }])).toEqual({
      status: 'insufficient',
      sku: 'SUT-1L',
      requested: 1,
      counter: -3,
      counterMissing: false,
    });
  });

  it('kullanici kilidi ayri slot ama BEYANLI: yuklemede bir kez bilgi, cagrida uyari yok', async () => {
    await seed({ 'SUT-1L': 5 });
    await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 1 }]);

    // Yalnizca slot uyarisina bakilir: NOSCRIPT sonrasi yeniden yukleme uyarisi
    // (onceki test) bilincli ve dogrudur.
    expect(
      loadLines.filter((line) => line.level === 'warn' && line.message.includes('hash-tag')),
    ).toEqual([]);
    expect(
      loadLines.filter(
        (line) => line.level === 'info' && line.fields['script'] === LUA_SCRIPTS.RESERVE,
      ),
    ).toHaveLength(1);
  });
});

describe('birakma (release.lua, T10.2)', () => {
  beforeEach(() => seed({ 'SUT-1L': 5, 'KOLA-1L': 3 }));

  const release = (order: number, reason = 'user_cancelled') =>
    reservations.release({
      orderId: orderId(order),
      marketId: MARKET,
      reason,
      nowMs: systemClock.now(),
    });

  const counterValues = () =>
    connection.redis.mget(stockAvailKey(MARKET, 'SUT-1L'), stockAvailKey(MARKET, 'KOLA-1L'));

  it('iz: kayit silinmez, state/gerekce/an eklenir ve iz omru kadar yasar; indeks uyesi ve kilit gider', async () => {
    await reserve(1, 1, [
      { sku: 'SUT-1L', quantity: 2 },
      { sku: 'KOLA-1L', quantity: 1 },
    ]);
    const nowMs = systemClock.now();

    await reservations.release({
      orderId: orderId(1),
      marketId: MARKET,
      reason: 'risk_rejected',
      nowMs,
    });

    const key = reservationKey(MARKET, orderId(1));
    expect(await connection.redis.hgetall(key)).toMatchObject({
      'qty:SUT-1L': '2',
      'qty:KOLA-1L': '1',
      state: 'released',
      reason: 'risk_rejected',
      settledAt: String(nowMs),
    });
    const ttl = await connection.redis.pttl(key);
    expect(ttl).toBeGreaterThan(SETTLED_RESERVATION_TTL_MS - TTL_TOLERANCE_MS);
    expect(ttl).toBeLessThanOrEqual(SETTLED_RESERVATION_TTL_MS);
    expect(await connection.redis.zscore(reservationIndexKey(MARKET), orderId(1))).toBeNull();
    expect(await connection.redis.exists(userReservationKey(userId(1)))).toBe(0);
    expect(await counterValues()).toEqual(['5', '3']);
  });

  it('forgetSettled izi siler', async () => {
    await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
    await release(1);

    await reservations.forgetSettled(MARKET, orderId(1));

    expect(await connection.redis.exists(reservationKey(MARKET, orderId(1)))).toBe(0);
  });

  it('ayni rezervasyonu 10 cagri ayni anda birakirsa sahipligi TEK cagri alir; stok bir kez doner', async () => {
    await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);

    const outcomes = await Promise.all(Array.from({ length: 10 }, () => release(1)));

    expect(outcomes.filter((outcome) => outcome.status === 'released')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'settled')).toHaveLength(9);
    expect(await counterValues()).toEqual(['5', '3']);
  });

  it('tam sayi olmayan sayac INTERNAL; HICBIR sey yazilmaz (diger kalem de artmaz)', async () => {
    await reserve(1, 1, [
      { sku: 'SUT-1L', quantity: 2 },
      { sku: 'KOLA-1L', quantity: 1 },
    ]);
    await connection.redis.set(stockAvailKey(MARKET, 'SUT-1L'), '3.5');

    await expect(release(1)).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL });
    expect(await counterValues()).toEqual(['3.5', '2']);
    expect(await connection.redis.zscore(reservationIndexKey(MARKET), orderId(1))).not.toBeNull();
    expect(await connection.redis.hget(reservationKey(MARKET, orderId(1)), 'state')).toBeNull();
  });

  it('sayaci OLMAYAN kalem atlanir, sayac yaratilmaz; digeri doner (skippedCounters)', async () => {
    await reserve(1, 1, [
      { sku: 'SUT-1L', quantity: 2 },
      { sku: 'KOLA-1L', quantity: 1 },
    ]);
    await connection.redis.del(stockAvailKey(MARKET, 'KOLA-1L'));

    const outcome = await release(1);

    expect(outcome).toMatchObject({ status: 'released', skippedCounters: 1 });
    expect(await counterValues()).toEqual(['5', null]);
  });

  it('indekste olup kaydi dusmus rezervasyon: orphaned, indeks temizlenir, sayaclara dokunulmaz', async () => {
    await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
    await connection.redis.del(reservationKey(MARKET, orderId(1)));

    expect(await release(1)).toEqual({ status: 'orphaned' });
    expect(await connection.redis.zscore(reservationIndexKey(MARKET), orderId(1))).toBeNull();
    expect(await counterValues()).toEqual(['3', '3']);
  });

  it('eskimis on okuma (kalemler farkli) stale: HICBIR sey yazilmaz', async () => {
    await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);

    const reply = await releaseScript.run(
      [
        reservationKey(MARKET, orderId(1)),
        reservationIndexKey(MARKET),
        stockAvailKey(MARKET, 'KOLA-1L'),
        userReservationKey(userId(1)),
      ],
      [orderId(1), userId(1), 'user_cancelled', systemClock.now(), 60_000, 'KOLA-1L'],
    );

    expect(reply).toEqual(['stale']);
    expect(await counterValues()).toEqual(['3', '3']);
    expect(await connection.redis.zscore(reservationIndexKey(MARKET), orderId(1))).not.toBeNull();
    expect(await connection.redis.get(userReservationKey(userId(1)))).toBe(orderId(1));
  });

  it('SCRIPT FLUSH sonrasi birakma calisir (NOSCRIPT -> yeniden yukleme)', async () => {
    await reserve(1, 1, [{ sku: 'SUT-1L', quantity: 2 }]);
    await connection.redis.script('FLUSH');

    expect((await release(1)).status).toBe('released');
  });

  it('kullanici kilidi ayri slot ama BEYANLI: birakmada da yuklemede bir kez bilgi', () => {
    expect(
      loadLines.filter(
        (line) => line.level === 'info' && line.fields['script'] === LUA_SCRIPTS.RELEASE,
      ),
    ).toHaveLength(1);
    expect(
      loadLines.filter((line) => line.level === 'warn' && line.message.includes('hash-tag')),
    ).toEqual([]);
  });
});

describe('Reserve gercek gRPC ve Redis ile', () => {
  it('rezervasyon musaitlikte hemen gorunur; yetmeyen kalem ayrintiyla doner, hicbiri dusmez', async () => {
    await seed({ 'SUT-1L': 5, 'KOLA-1L': 1 });
    const server = await startTestGrpcServer({
      serviceName: 'inventory-resv-it',
      services: [
        buildInventoryService({
          stock: {
            counters,
            reservations,
            ledger: new InMemoryStockLedger(),
            recoverCounters: () => Promise.resolve(false),
          },
        }),
      ],
    });
    const service = inventoryV1.InventoryServiceService;
    const request = (order: number, items: readonly ReservationLine[]) =>
      inventoryV1.ReserveRequest.fromPartial({
        orderId: orderId(order),
        marketId: MARKET,
        userId: userId(order),
        items: [...items],
        ttlSeconds: 600,
      });
    try {
      const refused = await server.call(
        service.reserve,
        request(1, [
          { sku: 'SUT-1L', quantity: 2 },
          { sku: 'KOLA-1L', quantity: 2 },
        ]),
      );
      expect(refused.error?.code).toBe(GRPC_STATUS.FAILED_PRECONDITION);
      expect(appErrorOf(refused.error)).toMatchObject({
        code: ERROR_CODES.STOCK_INSUFFICIENT,
        details: { sku: 'KOLA-1L', requested: 2, available: 1 },
      });

      const accepted = await server.call(
        service.reserve,
        request(2, [{ sku: 'SUT-1L', quantity: 2 }]),
      );
      expect(accepted.error).toBeUndefined();
      expect(accepted.response?.alreadyReserved).toBe(false);

      const availability = await server.call(service.checkAvailability, {
        darkStoreId: '',
        marketId: MARKET,
        skus: ['SUT-1L', 'KOLA-1L'],
      });
      expect(availability.response?.items).toEqual([
        { sku: 'SUT-1L', availableQuantity: 3 },
        { sku: 'KOLA-1L', availableQuantity: 1 },
      ]);
    } finally {
      await server.stop();
    }
  });
});
