/**
 * Odeme servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/payment-service build
 *   pnpm --filter @getir/payment-service start      (kok .env varsa okunur)
 *
 * Odemeler bugun BELLEKTE tutulur (payments koleksiyonu T5.3); servis yeniden
 * baslayinca unutulur. Saglayici mock'tur: test kartlari README'de.
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/payment/v1/payment.proto \
 *     -d '{...}' localhost:50054 getir.payment.v1.PaymentService/Charge
 */

import { createLogger, installProcessHandlers, startGrpcServer } from '@getir/service-kit';

import { buildPaymentService } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

const handle = await startGrpcServer({
  serviceName: SERVICE_NAME,
  host: env.GRPC_HOST,
  port: env.PAYMENT_GRPC_PORT,
  shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
  logger,
  services: [buildPaymentService({ logger })],
});

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

logger.info({ port: handle.port, storage: 'bellek', provider: 'mock' }, 'odeme servisi hazir');
