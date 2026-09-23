/**
 * Siparis servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/order-service build
 *   pnpm --filter @getir/order-service start      (kok .env varsa okunur)
 *
 * Depo MOCK ile secilir: MOCK=true -> bellek (Mongo gerekmez), aksi halde
 * MONGO_URI zorunlu ve siparisler `orders` koleksiyonuna yazilir.
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/order/v1/order.proto \
 *     -d '{...}' localhost:50053 getir.order.v1.OrderService/CreateDraftOrder
 */

import { createLogger, installProcessHandlers, startGrpcServer } from '@getir/service-kit';

import { buildOrderService } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { openOrderStore } from './infrastructure/order-store.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

const store = await openOrderStore(env.mongo, logger);

const handle = await startGrpcServer({
  serviceName: SERVICE_NAME,
  host: env.GRPC_HOST,
  port: env.ORDER_GRPC_PORT,
  shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
  logger,
  services: [buildOrderService({ logger, store })],
  // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti kesilmesin.
  onShutdown: () => store.close(),
});

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

// Depo bilincli olarak gunluge yaziliyor: "siparisim neden kayboldu?" sorusunun
// ilk cevabi hangi modda calisildigidir (bellek modu yeniden baslayinca unutur).
logger.info({ port: handle.port, mock: env.MOCK, storage: store.name }, 'siparis servisi hazir');
