/**
 * QA kara kutu (T15.2 geriye donuk tur, inventory PR 2; IQ5): supurucu liderligi GERCEK
 * sureclerle (dist/main.js, ayni Redis + Mongo; B25). Surec ici benzetim
 * (reservation-sweeper.spec) kilidi sahte saatle siner; burada gercek saat, gercek SIGKILL:
 *
 *   - Iki kopyadan TEK lider; lider yasarken kilit her turda yenilenir (kalan omru omrunun
 *     yarisinin altina inmez) ve sahibi degismez.
 *   - Lider, suresi dolan rezervasyonlari geri verirken (ilk geri verme goruldugu an) SIGKILL
 *     ile olur: kapanis kancasi calismaz, kilit birakilmaz, tur yarida kalabilir.
 *   - Takipci kilit omru + birkac tur icinde devralir ve kalanlari bitirir: her rezervasyonun
 *     stogu TAM BIR kez doner (sayac onHand'e, fazlasina degil; indeks bos); defterde hicbir
 *     siparisin iki expire kaydi yok.
 *   - Tasarim (sweep-expired.ts): lider sayaci dondurup defteri yazmadan olurse o siparisin
 *     expire kaydi eksik kalir (delta 0, eldeki adet bozulmaz), iz Redis'te "expired" durur ve
 *     ayni siparise gelen Release kaydi tamamlar. Test bunu da siner: en cok BIR siparis yarida
 *     kalabilir; kaydi olmayanin izi var ve Release tamamliyor. Release gelmezse kayit kalici
 *     olarak eksik kalir: bekleyen is #130 (supurucu izi tarasin ya da ZREM defterden sonra).
 *
 * Esikler gercek saatte titremesin diye genis: kilit 2 sn, tur 250 ms; yenileme esigi omrun
 * yarisi (~750 ms takilmaya dayanir). Rezervasyon suresi en az 30 sn
 * (RESERVATION_TTL_MIN_SECONDS): test ~40 sn surer.
 */

import { silentLogger } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import {
  RECONCILE_LOCK_KEY,
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
} from '@getir/redis-kit';
import { unaryCall } from '@getir/service-kit/testing';
import { Client, credentials } from '@grpc/grpc-js';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSeedStock } from '../../src/application/seed-stock.js';
import { RESERVATION_TTL_MIN_SECONDS } from '../../src/config/constants.js';
import type { StockStoresEnv } from '../../src/config/env.js';
import type { StockLevel } from '../../src/domain/stock.js';
import { LEDGER_KINDS } from '../../src/domain/stock-ledger.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { StockLedgerDocument } from '../../src/infrastructure/mongo/documents.js';
import { MongoStockSeedWriter } from '../../src/infrastructure/mongo/mongo-stock-seed-writer.js';
import type { StockStores } from '../../src/infrastructure/stock-stores.js';
import { openStockStores } from '../../src/infrastructure/stock-stores.js';
import {
  assertBuilt,
  killHard,
  logLines,
  startInventory,
  stopAllInventories,
  waitUntil,
} from '../support/qa-inventory-process.js';
import type { RunningInventory, StoresAddress } from '../support/qa-inventory-process.js';

const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const DB_NAME = 'qa_inventory_surec';
const MARKET = 'mkt_qa-surec';
const SKU = 'QA-SUREC';
const ON_HAND = 20;
const LEVELS: readonly StockLevel[] = [{ marketId: MARKET, sku: SKU, onHand: ON_HAND }];
/** Cok siparis: liderin geri verme turu uzar, SIGKILL'in tur ortasina dusme olasiligi artar. */
const ORDER_COUNT = 10;
const QUANTITY = 1;
/** Supurucu: tur 250 ms, kilit omru 2 sn (en az iki tur kurali rahat saglanir). */
const SWEEPER_INTERVAL_MS = 250;
const LOCK_TTL_MS = 2_000;
const SWEEPER_ENV = {
  SWEEPER_INTERVAL_MS: String(SWEEPER_INTERVAL_MS),
  SWEEPER_LOCK_TTL_SECONDS: String(LOCK_TTL_MS / 1_000),
};
const LEADER_MESSAGE = 'supurucu lider oldu';
const LOST_MESSAGE = 'supurucu liderligi kaybetti';
/** Gozlem penceresi: kilit omrunun iki kati (yenilenmeyen kilit bu surede sifira iner). */
const OBSERVE_MS = 2 * LOCK_TTL_MS;
/** Yenilenen kilidin kalan omru omrunun yarisinin altina inmez. */
const MIN_RENEWED_PTTL_MS = LOCK_TTL_MS / 2;
/** Devralma ust siniri: kilit omru + dort tur + surec zamanlama payi. */
const TAKEOVER_LIMIT_MS = LOCK_TTL_MS + 4 * SWEEPER_INTERVAL_MS + 2_000;
/** Ilk geri vermeyi yakalamak icin sayac yoklama araligi. */
const EXPIRY_POLL_MS = 10;
const TEST_TIMEOUT_MS = 90_000;
const service = inventoryV1.InventoryServiceService;

let mongoContainer: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
let stores: StockStores;
const clients: Client[] = [];

function storesEnv(): StockStoresEnv {
  return {
    mongo: {
      uri: `${mongoContainer.getConnectionString()}?directConnection=true`,
      dbName: DB_NAME,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: 5_000,
    },
    redis: { REDIS_URL: redisContainer.getConnectionUrl(), REDIS_CONNECT_TIMEOUT_MS: 5_000 },
  };
}

function address(): StoresAddress {
  const env = storesEnv();
  return { mongoUri: env.mongo.uri, mongoDb: DB_NAME, redisUrl: env.redis.REDIS_URL };
}

beforeAll(async () => {
  assertBuilt();
  [mongoContainer, redisContainer] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  stores = await openStockStores(storesEnv(), silentLogger, 'qa-surec');
  await createSeedStock({
    writer: new MongoStockSeedWriter(stores.mongo, stores.repository, stores.ledger),
    levels: LEVELS,
    isProduction: false,
  })();
}, 120_000);

afterAll(async () => {
  for (const client of clients.splice(0)) client.close();
  await stopAllInventories();
  await stores?.close();
  await Promise.all([mongoContainer?.stop(), redisContainer?.stop()]);
});

const ids = (n: number) => {
  const hex = (0x5c00 + n).toString(16).padStart(32, '0');
  return { orderId: `ord_${hex}`, userId: `usr_${hex}` };
};

async function counter(): Promise<number> {
  const raw = await stores.redis.redis.get(stockAvailKey(MARKET, SKU));
  if (raw === null) throw new Error('sayac anahtari yok');
  return Number(raw);
}

function expireCount(orderId: string): Promise<number> {
  return stores.mongo.db
    .collection<StockLedgerDocument>(COLLECTIONS.STOCK_LEDGER)
    .countDocuments({ marketId: MARKET, orderId, kind: LEDGER_KINDS.EXPIRE });
}

async function started(extra: Record<string, string> = SWEEPER_ENV): Promise<RunningInventory> {
  const inventory = await startInventory(address(), extra);
  if (!inventory.ready) throw new Error(`servis acilmadi:\n${inventory.output()}`);
  return inventory;
}

const leaderships = (inventory: RunningInventory) =>
  logLines(inventory.output(), LEADER_MESSAGE).length;

describe('QA IQ5 supurucu liderligi gercek sureclerle (B25)', () => {
  it(
    'tek lider, kilit yenilenir; lider geri verirken SIGKILL olur, takipci devralir; her rezervasyon TAM BIR kez',
    async () => {
      const first = await started();
      const second = await started();
      expect(
        await waitUntil(() => leaderships(first) + leaderships(second) === 1, 3 * LOCK_TTL_MS),
      ).toBe(true);
      const [leader, follower] = leaderships(first) === 1 ? [first, second] : [second, first];

      // Rezervasyonlar takipciden (lider olunce gRPC'si de gider).
      const client = new Client(`127.0.0.1:${follower.port}`, credentials.createInsecure());
      clients.push(client);
      for (let n = 1; n <= ORDER_COUNT; n += 1) {
        const { error, response } = await unaryCall(client, service.reserve, {
          ...ids(n),
          darkStoreId: '',
          marketId: MARKET,
          items: [{ sku: SKU, quantity: QUANTITY }],
          ttlSeconds: RESERVATION_TTL_MIN_SECONDS,
        });
        expect(error).toBeUndefined();
        expect(response?.alreadyReserved).toBe(false);
      }
      const reserved = ON_HAND - ORDER_COUNT * QUANTITY;
      expect(await counter()).toBe(reserved);

      // Lider yasarken: sahibi ayni, kalan omur yarisinin altina inmez (yenileniyor), devir yok.
      const owner = await stores.redis.redis.get(RECONCILE_LOCK_KEY);
      expect(owner).not.toBeNull();
      let minPttl = Number.POSITIVE_INFINITY;
      const until = Date.now() + OBSERVE_MS;
      while (Date.now() < until) {
        minPttl = Math.min(minPttl, await stores.redis.redis.pttl(RECONCILE_LOCK_KEY));
        expect(await stores.redis.redis.get(RECONCILE_LOCK_KEY)).toBe(owner);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(minPttl).toBeGreaterThanOrEqual(MIN_RENEWED_PTTL_MS);
      expect(leaderships(follower)).toBe(0);
      expect(logLines(leader.output(), LOST_MESSAGE)).toEqual([]);

      // Lider ILK geri vermeyi yaptigi an olur: tur yarida kalabilir, kilit birakilmaz.
      const dueBudget = RESERVATION_TTL_MIN_SECONDS * 1_000 + 10 * SWEEPER_INTERVAL_MS;
      expect(
        await waitUntil(async () => (await counter()) > reserved, dueBudget, EXPIRY_POLL_MS),
      ).toBe(true);
      const killedAt = Date.now();
      await killHard(leader.child);

      expect(await waitUntil(() => leaderships(follower) === 1, TAKEOVER_LIMIT_MS)).toBe(true);
      expect(Date.now() - killedAt).toBeLessThanOrEqual(TAKEOVER_LIMIT_MS);
      expect(await stores.redis.redis.get(RECONCILE_LOCK_KEY)).not.toBe(owner);

      // Yeni lider kalanlari bitirir; ikinci kez geri verilmez (sayac onHand'i ASMAZ).
      expect(
        await waitUntil(async () => (await counter()) === ON_HAND, TAKEOVER_LIMIT_MS, 100),
      ).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 5 * SWEEPER_INTERVAL_MS));
      expect(await counter()).toBe(ON_HAND);
      expect(await stores.redis.redis.zcard(reservationIndexKey(MARKET))).toBe(0);
      let halfDone = 0;
      for (let n = 1; n <= ORDER_COUNT; n += 1) {
        const { orderId } = ids(n);
        const entries = await expireCount(orderId);
        expect(entries).toBeLessThanOrEqual(1);
        if (entries === 1) continue;
        // Yarida kalan sure dolumu (#130): iz duruyor, ayni siparise gelen Release defteri tamamlar.
        halfDone += 1;
        expect(await stores.redis.redis.hget(reservationKey(MARKET, orderId), 'state')).toBe(
          'expired',
        );
        const release = await unaryCall(client, service.release, {
          orderId,
          darkStoreId: '',
          marketId: MARKET,
          reason: 'user_cancelled',
        });
        expect(release.error).toBeUndefined();
        expect(await expireCount(orderId)).toBe(1);
      }
      // Tur siparisleri sirayla isler: SIGKILL anindaki en cok bir siparis yarida kalir.
      expect(halfDone).toBeLessThanOrEqual(1);
      expect(await counter()).toBe(ON_HAND);
    },
    TEST_TIMEOUT_MS,
  );
});
