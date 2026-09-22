/**
 * Seed giris noktasi: katalogu demo verisiyle bastan yazar.
 *
 *   pnpm seed                                   (kokten; once derler)
 *   pnpm --filter @getir/catalog-service seed   (derlenmis dist'ten)
 *
 * Tekrar kosmak GUVENLIDIR: koleksiyonlar tek transaction'da silinip yeniden
 * yazilir, ikinci bir kopya olusmaz. NODE_ENV=production iken reddeder.
 */

import { connectMongo } from '@getir/mongo-kit';
import { createLogger } from '@getir/service-kit';

import { createSeedCatalog } from './application/seed-catalog.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadSeedEnv } from './config/env.js';
import { CATALOG_SNAPSHOT } from './infrastructure/fixtures.js';
import { MongoCatalog } from './infrastructure/mongo/mongo-catalog.js';

/** Seed basarisiz oldugunda cikis kodu. */
const SEED_FAILURE_EXIT_CODE = 1;

const env = loadSeedEnv();
const logger = createLogger({ name: `${SERVICE_NAME}-seed`, level: env.LOG_LEVEL });

const connection = await connectMongo({
  uri: env.MONGO_URI,
  dbName: env.MONGO_DB,
  serverSelectionTimeoutMs: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
  appName: `${SERVICE_NAME}-seed`,
  logger,
});

try {
  const catalog = new MongoCatalog(connection);
  // Indeks transaction icinde olusturulamaz; benzersizlik kurali ilk yazimdan
  // itibaren gecerli olsun diye yazimdan ONCE.
  await catalog.ensureIndexes();

  const seed = createSeedCatalog({
    writer: catalog,
    snapshot: CATALOG_SNAPSHOT,
    isProduction: env.NODE_ENV === 'production',
  });
  const counts = await seed();

  logger.info({ db: env.MONGO_DB, ...counts }, 'katalog seed tamamlandi');
} catch (error: unknown) {
  logger.error({ err: error }, 'katalog seed basarisiz');
  process.exitCode = SEED_FAILURE_EXIT_CODE;
} finally {
  await connection.close();
}
