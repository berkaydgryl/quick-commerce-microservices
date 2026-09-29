/**
 * Servisin stok kaynagini ACAR: MOCK=true -> bellek, aksi halde Mongo + Redis.
 *
 * Mongo + Redis modunda sayaclar gRPC portu acilmadan ONCE yazilir (ADR-03:
 * "seed bitmeden servis hazir sayilmaz"): port acik degilken saglik yoklamasi
 * da basarisizdir, servis hazir gorunmez. Yalnizca OLMAYAN sayac yazilir
 * (application/seed-counters.ts).
 */

import type { Logger } from '@getir/core';

import type { SeedCountersResult } from '../application/seed-counters.js';
import { createSeedCounters } from '../application/seed-counters.js';
import { SERVICE_NAME } from '../config/constants.js';
import type { StockStoresEnv } from '../config/env.js';
import type { StockCounterReader } from '../domain/stock.js';
import { STOCK_LEVELS } from './fixtures/stock-levels.js';
import { InMemoryStockCounters } from './memory/in-memory-stock-counters.js';
import { openStockStores } from './stock-stores.js';

export interface StockSource {
  readonly counters: StockCounterReader;
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
    return {
      counters: new InMemoryStockCounters(STOCK_LEVELS),
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
    return {
      counters: opened.counters,
      name: 'mongo + redis',
      seeded,
      close: () => opened.close(),
    };
  } catch (error: unknown) {
    await opened.close();
    throw error;
  }
}
