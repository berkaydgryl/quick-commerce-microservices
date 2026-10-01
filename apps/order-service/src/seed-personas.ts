/**
 * Persona seed giris noktasi (T8.1): demo personalarinin siparis gecmisini
 * bastan yazar. Hesaplarin kendisi gateway'in seed'indedir (ADR-05).
 *
 *   pnpm seed:personas                                   (kokten; gateway ile birlikte)
 *   pnpm --filter @getir/order-service seed:personas     (derlenmis dist'ten)
 *
 * Tekrar kosmak GUVENLIDIR: personalarin siparisleri tek transaction'da silinip
 * yeniden yazilir, ikinci kopya olusmaz; tarihler calisma anina gore kurulur.
 * NODE_ENV=production iken reddeder. MOCK=true'da gecmis servis acilirken
 * bellege yuklenir; bu komut gerekmez.
 */

import { connectMongo } from '@getir/mongo-kit';
import { createLogger, startOrExit } from '@getir/service-kit';

import { createSeedPersonaOrders } from './application/seed-persona-orders.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadSeedEnv } from './config/env.js';
import { buildPersonaOrders, personaUserIds } from './infrastructure/fixtures/persona-orders.js';
import { MongoPersonaOrderWriter } from './infrastructure/mongo/mongo-persona-order-writer.js';
import { OrdersCollection } from './infrastructure/mongo/orders-collection.js';

/** Seed basarisiz oldugunda cikis kodu. */
const SEED_FAILURE_EXIT_CODE = 1;

const env = loadSeedEnv();
const logger = createLogger({ name: `${SERVICE_NAME}-seed`, level: env.LOG_LEVEL });

// Baglanti try'in DISINDA: ulasilamazsa kapatilacak baglanti yoktur.
const connection = await startOrExit(
  () => connectMongo({ ...env.mongo, appName: `${SERVICE_NAME}-seed`, logger }),
  { logger, message: 'seed icin mongo baglantisi kurulamadi' },
);

try {
  const orders = new OrdersCollection(connection.db);
  // Servisin okudugu indeks yazimdan ONCE kurulur (servis henuz hic acilmamis olabilir).
  await orders.ensureIndexes();

  const seed = createSeedPersonaOrders({
    writer: new MongoPersonaOrderWriter(orders, connection),
    userIds: personaUserIds(),
    orders: buildPersonaOrders(new Date()),
    isProduction: env.NODE_ENV === 'production',
  });
  const counts = await seed();

  logger.info({ db: env.mongo.dbName, ...counts }, 'persona siparis gecmisi yazildi');
} catch (error: unknown) {
  logger.error({ err: error }, 'persona seed basarisiz');
  process.exitCode = SEED_FAILURE_EXIT_CODE;
} finally {
  await connection.close();
}
