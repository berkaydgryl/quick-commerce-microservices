/**
 * Reseed giris noktasi: Redis'teki stok sayaclarini kalici stoktan (Mongo)
 * BASTAN yazar (T9.2). Redis bosaltildiginda ya da kaybedildiginde kullanilir:
 * "Redis silinip yeniden kurulur" (ADR-03: Redis kaybi veri kaybi degil,
 * yeniden isinma maliyetidir).
 *
 *   pnpm --filter @getir/inventory-service reseed
 *
 * DIKKAT (T10'dan sonra): sayac rezervasyonlari yansitir. Aktif rezervasyon
 * varken calistirilirsa ayrilmis stok geri satisa cikar; yalnizca Redis
 * bosken (rezervasyonlar da gitmisken) ya da rezervasyon yokken kosulur.
 */

import { createLogger, startOrExit } from '@getir/service-kit';

import { createSeedCounters } from './application/seed-counters.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadCommandEnv } from './config/env.js';
import { openStockStores } from './infrastructure/stock-stores.js';

/** Reseed basarisiz oldugunda cikis kodu. */
const RESEED_FAILURE_EXIT_CODE = 1;

const env = loadCommandEnv();
const appName = `${SERVICE_NAME}-reseed`;
const logger = createLogger({ name: appName, level: env.LOG_LEVEL });

const stores = await startOrExit(() => openStockStores(env, logger, appName), {
  logger,
  message: 'reseed icin mongo/redis baglantisi kurulamadi',
});

try {
  const counters = await createSeedCounters({
    levels: stores.repository,
    counters: stores.counters,
  })('overwrite');
  logger.info({ ...counters }, 'stok sayaclari yeniden kuruldu');
} catch (error: unknown) {
  logger.error({ err: error }, 'stok sayaclari yeniden kurulamadi');
  process.exitCode = RESEED_FAILURE_EXIT_CODE;
} finally {
  await stores.close();
}
