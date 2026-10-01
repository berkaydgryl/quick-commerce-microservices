/**
 * Servisin stok kaynagini ACAR: MOCK=true -> bellek, aksi halde Mongo + Redis.
 *
 * Mongo + Redis modunda sayaclar gRPC portu acilmadan ONCE yazilir (ADR-03:
 * "seed bitmeden servis hazir sayilmaz"): port acik degilken saglik yoklamasi
 * da basarisizdir, servis hazir gorunmez. Yalnizca OLMAYAN sayac yazilir
 * (application/seed-counters.ts). Lua script'leri de portTAN ONCE yuklenir
 * (T10.1): lua/ klasoru eksikse servis acilmaz, ilk rezervasyonda patlamaz.
 */

import { randomUUID } from 'node:crypto';

import type { Logger } from '@getir/core';

import { createCounterRecovery } from '../application/counter-recovery.js';
import type { SeedCountersResult } from '../application/seed-counters.js';
import { createSeedCounters } from '../application/seed-counters.js';
import {
  COUNTER_RECOVERY_TIMEOUT_MS,
  DEFAULT_SWEEPER_LOCK_TTL_SECONDS,
  LUA_SCRIPTS,
  MS_PER_SECOND,
  RESERVATION_HOLD_AFTER_EXPIRY_MS,
  SERVICE_NAME,
  SETTLED_RESERVATION_TTL_MS,
} from '../config/constants.js';
import type { StockStoresEnv } from '../config/env.js';
import type { LeaderLock } from '../domain/leader-lock.js';
import type { StockPorts } from '../domain/stock-ports.js';
import type { StockMarketSource } from '../domain/stock.js';
import { STOCK_LEVELS } from './fixtures/stock-levels.js';
import { InMemoryLeaderLock } from './memory/in-memory-leader-lock.js';
import { createInMemoryStock } from './memory/in-memory-stock.js';
import { loadInventoryScripts } from './redis/lua-scripts.js';
import { RedisLeaderLock } from './redis/redis-leader-lock.js';
import { RedisReservationStore } from './redis/redis-reservation-store.js';
import { openStockStores } from './stock-stores.js';

export interface StockSource extends StockPorts {
  /** Gunlukte gorunen ad: hangi modda calisiyoruz? */
  readonly name: 'bellek (MOCK)' | 'mongo + redis';
  /** Acilista Redis'e yazilan sayaclar; MOCK'ta yok. */
  readonly seeded: SeedCountersResult | undefined;
  /** Supurucunun tarayacagi marketler (T10.3). */
  readonly markets: StockMarketSource;
  /** Supurucu liderligi (T10.3, B25): Redis'te lock:reconcile, MOCK'ta hep lider. */
  readonly leader: LeaderLock;
  /** Kapanista EN SON cagrilir (proje kurali: once cagrilar, sonra depolar). */
  close(): Promise<void>;
}

export interface StockSourceOptions {
  /** Supurucu liderlik kilidinin omru (ms; SWEEPER_LOCK_TTL_SECONDS). */
  readonly lockTtlMs?: number;
}

export async function openStockSource(
  stores: StockStoresEnv | undefined,
  logger: Logger,
  options: StockSourceOptions = {},
): Promise<StockSource> {
  if (stores === undefined) {
    const memory = createInMemoryStock(STOCK_LEVELS);
    const marketIds = [...new Set(STOCK_LEVELS.map((level) => level.marketId))].sort();
    return {
      counters: memory.counters,
      reservations: memory.reservations,
      ledger: memory.ledger,
      committer: memory.committer,
      recoverCounters: memory.recoverCounters,
      name: 'bellek (MOCK)',
      seeded: undefined,
      markets: { marketIds: () => Promise.resolve(marketIds) },
      leader: new InMemoryLeaderLock(),
      close: () => Promise.resolve(),
    };
  }

  const opened = await openStockStores(stores, logger, SERVICE_NAME);
  try {
    const seedCounters = createSeedCounters({
      levels: opened.repository,
      counters: opened.counters,
      marker: opened.marker,
    });
    const seeded = await seedCounters('missing');
    const scripts = await loadInventoryScripts(opened.redis.redis, logger);
    return {
      counters: opened.counters,
      reservations: new RedisReservationStore(
        opened.redis.redis,
        {
          reserve: scripts.get(LUA_SCRIPTS.RESERVE),
          release: scripts.get(LUA_SCRIPTS.RELEASE),
          commit: scripts.get(LUA_SCRIPTS.COMMIT),
        },
        {
          holdAfterExpiryMs: RESERVATION_HOLD_AFTER_EXPIRY_MS,
          settledTtlMs: SETTLED_RESERVATION_TTL_MS,
        },
      ),
      ledger: opened.ledger,
      committer: opened.committer,
      // Redis bosalirsa: acilistaki yolla, yalnizca eksik sayaclar (T10.1 PR 2).
      recoverCounters: createCounterRecovery({
        marker: opened.marker,
        reseed: () => seedCounters('missing'),
        logger,
        timeoutMs: COUNTER_RECOVERY_TIMEOUT_MS,
      }),
      name: 'mongo + redis',
      seeded,
      markets: opened.repository,
      // Belirtec surec basina tek: kilidi yalnizca bu ornek yeniler ya da birakir.
      leader: new RedisLeaderLock(
        scripts.get(LUA_SCRIPTS.LEADER),
        randomUUID(),
        options.lockTtlMs ?? DEFAULT_SWEEPER_LOCK_TTL_SECONDS * MS_PER_SECOND,
      ),
      close: () => opened.close(),
    };
  } catch (error: unknown) {
    await opened.close();
    throw error;
  }
}
