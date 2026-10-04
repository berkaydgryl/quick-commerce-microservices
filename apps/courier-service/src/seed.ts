/**
 * Seed giris noktasi: couriers koleksiyonunu demo kuryeleriyle bastan yazar
 * (katalogdaki her markete uc kurye, hepsi IDLE ve marketin konumunda).
 *
 *   pnpm seed                                    (kokten; once derler)
 *   pnpm --filter @getir/courier-service seed    (derlenmis dist'ten)
 *
 * Tekrar kosmak GUVENLIDIR: koleksiyon tek transaction'da silinip yeniden
 * yazilir; atanmis kuryeler de bosa cikar (demo sifirlamasi). NODE_ENV=production
 * iken reddeder.
 */

import { systemClock } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import { createLogger, startOrExit } from '@getir/service-kit';

import { createSeedCouriers } from './application/seed-couriers.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadCommandEnv } from './config/env.js';
import { COURIER_SEEDS } from './infrastructure/fixtures/couriers.js';
import { CouriersCollection } from './infrastructure/mongo/couriers-collection.js';
import { MongoCourierSeedWriter } from './infrastructure/mongo/mongo-courier-seed-writer.js';

/** Seed basarisiz oldugunda cikis kodu. */
const SEED_FAILURE_EXIT_CODE = 1;

const env = loadCommandEnv();
const appName = `${SERVICE_NAME}-seed`;
const logger = createLogger({ name: appName, level: env.LOG_LEVEL });

// Baglanti try'in DISINDA: ulasilamazsa kapatilacak baglanti yoktur. Yine de
// hata duz metin yigin izi olarak degil, tek satir fatal JSON olarak yazilir.
const connection = await startOrExit(() => connectMongo({ ...env.mongo, appName, logger }), {
  logger,
  message: 'seed icin mongo baglantisi kurulamadi',
});

try {
  const couriers = new CouriersCollection(connection.db);
  // Indeks transaction icinde olusturulamaz; benzersizlik kurali ilk yazimdan
  // itibaren gecerli olsun diye yazimdan ONCE.
  await couriers.ensureIndexes();

  const counts = await createSeedCouriers({
    writer: new MongoCourierSeedWriter(connection, couriers),
    seeds: COURIER_SEEDS,
    isProduction: env.NODE_ENV === 'production',
    clock: systemClock,
  })();

  logger.info({ db: env.mongo.dbName, ...counts }, 'kurye seed tamamlandi');
} catch (error: unknown) {
  logger.error({ err: error }, 'kurye seed basarisiz');
  process.exitCode = SEED_FAILURE_EXIT_CODE;
} finally {
  await connection.close();
}
