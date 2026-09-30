/**
 * Servisin stok kaynagini ACAR: MOCK=true -> bellek, aksi halde Mongo + Redis.
 *
 * Mongo + Redis modunda sayaclar gRPC portu acilmadan ONCE yazilir (ADR-03:
 * "seed bitmeden servis hazir sayilmaz"): port acik degilken saglik yoklamasi
 * da basarisizdir, servis hazir gorunmez. Yalnizca OLMAYAN sayac yazilir
 * (application/seed-counters.ts). Lua script'leri de portTAN ONCE yuklenir
 * (T10.1): lua/ klasoru eksikse servis acilmaz, ilk rezervasyonda patlamaz.
 */

import type { Logger } from '@getir/core';

import type { SeedCountersResult } from '../application/seed-counters.js';
import { createSeedCounters } from '../application/seed-counters.js';
import {
  LUA_SCRIPTS,
  RESERVATION_HOLD_AFTER_EXPIRY_MS,
  SERVICE_NAME,
} from '../config/constants.js';
import type { StockStoresEnv } from '../config/env.js';
import type { StockPorts } from '../domain/stock-ports.js';
import { STOCK_LEVELS } from './fixtures/stock-levels.js';
import { createInMemoryStock } from './memory/in-memory-stock.js';
import { loadInventoryScripts } from './redis/lua-scripts.js';
import { RedisReservationStore } from './redis/redis-reservation-store.js';
import { openStockStores } from './stock-stores.js';

export interface StockSource extends StockPorts {
  /** Gunlukte gorunen ad: hangi modda calisiyoruz? */
  readonly name: 'bellek (MOCK)' | 'mongo + redis';
  /** Acilista Redis'e yazilan sayaclar; MOCK'ta yok. */
  readonly seeded: SeedCountersResult | undefined;
  /** Kapanista EN SON cagrilir (proje kurali: once cagrilar, sonra depolar). */
  close(): Promise<void>;
}

export async function openStockSource(
  stores: StockStoresEnv | undefined,
  logger: Logger,
): Promise<StockSource> {
  if (stores === undefined) {
    const memory = createInMemoryStock(STOCK_LEVELS);
    return {
      counters: memory.counters,
      reservations: memory.reservations,
      name: 'bellek (MOCK)',
      seeded: undefined,
      close: () => Promise.resolve(),
    };
  }

  const opened = await openStockStores(stores, logger, SERVICE_NAME);
  try {
    const seeded = await createSeedCounters({
      levels: opened.repository,
      counters: opened.counters,
    })('missing');
    const scripts = await loadInventoryScripts(opened.redis.redis, logger);
    return {
      counters: opened.counters,
      reservations: new RedisReservationStore(scripts.get(LUA_SCRIPTS.RESERVE), {
        holdAfterExpiryMs: RESERVATION_HOLD_AFTER_EXPIRY_MS,
      }),
      name: 'mongo + redis',
      seeded,
      close: () => opened.close(),
    };
  } catch (error: unknown) {
    await opened.close();
    throw error;
  }
}
