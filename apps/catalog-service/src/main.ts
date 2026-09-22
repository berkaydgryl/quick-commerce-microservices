/**
 * Katalog servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/catalog-service build
 *   pnpm --filter @getir/catalog-service start
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/catalog/v1/catalog.proto \
 *     localhost:50051 getir.catalog.v1.CatalogService/ListCategories
 */

import { createLogger, installProcessHandlers, startGrpcServer } from '@getir/service-kit';

import { buildCatalogService } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { env } from './config/env.js';

const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

const handle = await startGrpcServer({
  serviceName: SERVICE_NAME,
  host: env.GRPC_HOST,
  port: env.CATALOG_GRPC_PORT,
  shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
  logger,
  services: [buildCatalogService({ logger })],
});

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

// Veri kaynagi bilincli olarak gunluge yaziliyor: bugun bellekteki sahte veri
// okunuyor (T3.1). T4.1'de Mongo gelince bu satir kaynagi ayirt etmeyi saglar.
logger.info(
  { port: handle.port, mock: env.MOCK, source: 'bellek (T3.1 sahte veri)' },
  'katalog servisi hazir',
);
