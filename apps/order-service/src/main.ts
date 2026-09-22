/**
 * Siparis servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/order-service build
 *   pnpm --filter @getir/order-service start
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/order/v1/order.proto \
 *     -d '{...}' localhost:50053 getir.order.v1.OrderService/CreateDraftOrder
 */

import { createLogger, installProcessHandlers, startGrpcServer } from '@getir/service-kit';

import { buildOrderService } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { env } from './config/env.js';

const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

const handle = await startGrpcServer({
  serviceName: SERVICE_NAME,
  host: env.GRPC_HOST,
  port: env.ORDER_GRPC_PORT,
  shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
  logger,
  services: [buildOrderService({ logger })],
});

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

// Kalicilik durumu bilincli olarak gunluge yaziliyor: bugun siparisler
// BELLEKTE, process yeniden baslayinca kayboluyor (T4.5'te Mongo gelecek).
logger.info(
  { port: handle.port, mock: env.MOCK, storage: 'bellek (T3.2 - kalicilik yok)' },
  'siparis servisi hazir',
);
