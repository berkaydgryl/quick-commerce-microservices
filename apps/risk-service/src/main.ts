/**
 * Risk servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/risk-service build
 *   pnpm --filter @getir/risk-service start      (kok .env varsa okunur)
 *
 * Depo MOCK ile secilir: MOCK=true -> bellek, aksi halde RISK_MONGO_URI zorunlu
 * ve degerlendirmeler kendi veritabaninin (D14) `risk_events` koleksiyonuna
 * yazilir.
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/risk/v1/risk.proto \
 *     -d '{"context":{...}}' localhost:50055 getir.risk.v1.RiskService/Evaluate
 */

import {
  createLogger,
  installProcessHandlers,
  startGrpcServer,
  startOrExit,
} from '@getir/service-kit';

import { PendingRecords } from './application/pending-records.js';
import { buildRiskService } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { drainThenClose, recordDrainTimeoutMs } from './infrastructure/record-shutdown.js';
import { openRiskEventStore } from './infrastructure/risk-event-store.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

// Acilis adimlari (veri kaynagi, indeksler, port) sarilir: biri basarisizsa hata
// duz metin yigin izi yerine tek satir fatal JSON olarak yazilir ve process kapanir.
const { handle, store } = await startOrExit(
  async () => {
    const opened = await openRiskEventStore(env.mongo, logger);
    // Sure sinirini asip arka planda suren kayitlar (#167): kapanista beklenir.
    const pendingRecords = new PendingRecords();
    const server = await startGrpcServer({
      serviceName: SERVICE_NAME,
      host: env.GRPC_HOST,
      port: env.RISK_GRPC_PORT,
      shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
      // Izler (D15): adres yoksa olusur ve tasinir, disari gonderilmez.
      otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      logger,
      services: [buildRiskService({ logger, events: opened.repository, pendingRecords })],
      // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti kesilmesin.
      // Once arka plandaki kayitlar (sinirli bekleme), Mongo EN SON (#167).
      onShutdown: () =>
        drainThenClose({
          pending: pendingRecords,
          timeoutMs: recordDrainTimeoutMs(env.mongo),
          close: () => opened.close(),
          logger,
        }),
    });
    return { handle: server, store: opened };
  },
  { logger },
);

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

logger.info({ port: handle.port, mock: env.MOCK, storage: store.name }, 'risk servisi hazir');
