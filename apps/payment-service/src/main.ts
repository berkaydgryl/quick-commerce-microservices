/**
 * Odeme servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/payment-service build
 *   pnpm --filter @getir/payment-service start      (kok .env varsa okunur)
 *
 * Depo MOCK ile secilir: MOCK=true -> bellek (Mongo gerekmez, yeniden
 * baslayinca unutur), aksi halde MONGO_URI zorunlu ve odemeler `payments`
 * koleksiyonuna yazilir. Saglayici her iki modda mock'tur: test kartlari README'de.
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/payment/v1/payment.proto \
 *     -d '{...}' localhost:50054 getir.payment.v1.PaymentService/Charge
 */

import {
  createLogger,
  installProcessHandlers,
  startGrpcServer,
  startOrExit,
} from '@getir/service-kit';

import { buildPaymentService } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { openPaymentStore } from './infrastructure/payment-store.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

// Acilis adimlari (veri kaynagi, indeksler, port) sarilir: biri basarisizsa hata
// duz metin yigin izi yerine tek satir fatal JSON olarak yazilir ve process kapanir.
const { handle, store } = await startOrExit(
  async () => {
    const opened = await openPaymentStore(env.mongo, logger);
    const server = await startGrpcServer({
      serviceName: SERVICE_NAME,
      host: env.GRPC_HOST,
      port: env.PAYMENT_GRPC_PORT,
      shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
      logger,
      services: [buildPaymentService({ logger, repository: opened.repository })],
      // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti kesilmesin.
      onShutdown: () => opened.close(),
    });
    return { handle: server, store: opened };
  },
  { logger },
);

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

// Depo gunluge yazilir: "odemem neden kayboldu?" sorusunun ilk cevabi moddur.
logger.info(
  { port: handle.port, mock: env.MOCK, storage: store.name, provider: 'mock' },
  'odeme servisi hazir',
);
