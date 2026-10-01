/**
 * Katalog servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/catalog-service build
 *   pnpm --filter @getir/catalog-service start      (kok .env varsa okunur)
 *
 * Veri kaynagi MOCK ile secilir: MOCK=true -> bellek (Mongo gerekmez),
 * aksi halde CATALOG_MONGO_URI zorunlu (kendi veritabani ve kullanicisi, D14).
 * Mongo'yu doldurmak icin: pnpm seed
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/catalog/v1/catalog.proto \
 *     localhost:50051 getir.catalog.v1.CatalogService/ListCategories
 */

import {
  createLogger,
  installProcessHandlers,
  startGrpcServer,
  startOrExit,
} from '@getir/service-kit';

import { buildCatalogService } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { openCatalogSource } from './infrastructure/catalog-source.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

// Acilis adimlari (veri kaynagi, indeksler, port) sarilir: biri basarisizsa hata
// duz metin yigin izi yerine tek satir fatal JSON olarak yazilir ve process kapanir.
const { handle, source } = await startOrExit(
  async () => {
    const opened = await openCatalogSource(env.mongo, logger);
    const server = await startGrpcServer({
      serviceName: SERVICE_NAME,
      host: env.GRPC_HOST,
      port: env.CATALOG_GRPC_PORT,
      shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
      // Izler (D15): adres yoksa olusur ve tasinir, disari gonderilmez.
      otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      logger,
      services: [buildCatalogService({ logger, readers: opened.readers })],
      // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti kesilmesin.
      onShutdown: () => opened.close(),
    });
    return { handle: server, source: opened };
  },
  { logger },
);

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

// Veri kaynagi bilincli olarak gunluge yaziliyor: "neden bos liste?" sorusunun
// ilk cevabi hangi modda calisildigidir.
logger.info({ port: handle.port, mock: env.MOCK, source: source.name }, 'katalog servisi hazir');
