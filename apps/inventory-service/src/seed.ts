/**
 * Seed giris noktasi: kalici stogu demo verisiyle bastan yazar, sonra Redis
 * sayaclarini ondan yeniden kurar (overwrite).
 *
 *   pnpm seed                                     (kokten; once derler)
 *   pnpm --filter @getir/inventory-service seed   (derlenmis dist'ten)
 *
 * NEDEN SAYACLAR DA: seed stok gercegini topluca degistirir. Servisin acilis
 * seed'i var olan sayaca dokunmaz (rezervasyonlari korur); sayaclar burada
 * yenilenmezse Redis eski stogu gostermeye devam ederdi.
 *
 * Tekrar kosmak GUVENLIDIR: koleksiyon tek transaction'da silinip yeniden
 * yazilir. NODE_ENV=production iken reddeder.
 */

import { createLogger, startOrExit } from '@getir/service-kit';

import { createSeedCounters } from './application/seed-counters.js';
import { createSeedStock } from './application/seed-stock.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadCommandEnv } from './config/env.js';
import { STOCK_LEVELS } from './infrastructure/fixtures/stock-levels.js';
import { MongoStockSeedWriter } from './infrastructure/mongo/mongo-stock-seed-writer.js';
import { openStockStores } from './infrastructure/stock-stores.js';

/** Seed basarisiz oldugunda cikis kodu. */
const SEED_FAILURE_EXIT_CODE = 1;

const env = loadCommandEnv();
const appName = `${SERVICE_NAME}-seed`;
const logger = createLogger({ name: appName, level: env.LOG_LEVEL });

const stores = await startOrExit(() => openStockStores(env, logger, appName), {
  logger,
  message: 'seed icin mongo/redis baglantisi kurulamadi',
});

try {
  const stock = await createSeedStock({
    writer: new MongoStockSeedWriter(stores.mongo, stores.repository),
    levels: STOCK_LEVELS,
    isProduction: env.NODE_ENV === 'production',
  })();
  const counters = await createSeedCounters({
    levels: stores.repository,
    counters: stores.counters,
    marker: stores.marker,
  })('overwrite');
  logger.info({ db: env.mongo.MONGO_DB, ...stock, counters }, 'stok seed tamamlandi');
} catch (error: unknown) {
  logger.error({ err: error }, 'stok seed basarisiz');
  process.exitCode = SEED_FAILURE_EXIT_CODE;
} finally {
  await stores.close();
}
