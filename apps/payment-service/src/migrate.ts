/**
 * Goc komutu (T10.4, ADR-19):
 *
 *   pnpm --filter @getir/payment-service migrate up | down | status
 *   pnpm migrate up | status                     (kokten butun servisler)
 *
 * Servis acilista bekleyen gocleri zaten uygular; komut elle geri alma ve
 * durum icindir. Cikis kodu: 0 basarili, 1 basarisiz ya da tutarsiz, 2 kullanim.
 */

import { migrateMain } from '@getir/mongo-kit';
import { createLogger } from '@getir/service-kit';

import { SERVICE_NAME } from './config/constants.js';
import { loadMigrateEnv } from './config/env.js';
import { MIGRATIONS } from './migrations/index.js';

const env = loadMigrateEnv();
const logger = createLogger({ name: `${SERVICE_NAME}-migrate`, level: env.LOG_LEVEL });

process.exitCode = await migrateMain({
  command: process.argv[2],
  mongo: env.mongo,
  migrations: MIGRATIONS,
  appName: `${SERVICE_NAME}-migrate`,
  logger,
});
