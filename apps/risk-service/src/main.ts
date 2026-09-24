/**
 * Risk servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/risk-service build
 *   pnpm --filter @getir/risk-service start      (kok .env varsa okunur)
 *
 * Depo MOCK ile secilir: MOCK=true -> bellek, aksi halde MONGO_URI zorunlu ve
 * degerlendirmeler `risk_events` koleksiyonuna yazilir.
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/risk/v1/risk.proto \
 *     -d '{"context":{...}}' localhost:50055 getir.risk.v1.RiskService/Evaluate
 */

import { createLogger, installProcessHandlers, startGrpcServer } from '@getir/service-kit';

import { buildRiskService } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { openRiskEventStore } from './infrastructure/risk-event-store.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

const store = await openRiskEventStore(env.mongo, logger);

const handle = await startGrpcServer({
  serviceName: SERVICE_NAME,
  host: env.GRPC_HOST,
  port: env.RISK_GRPC_PORT,
  shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
  logger,
  services: [buildRiskService({ logger, events: store.repository })],
  // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti kesilmesin.
  onShutdown: () => store.close(),
});

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

logger.info({ port: handle.port, mock: env.MOCK, storage: store.name }, 'risk servisi hazir');
