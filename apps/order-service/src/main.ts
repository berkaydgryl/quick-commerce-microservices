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

import {
  createLogger,
  installProcessHandlers,
  startGrpcServer,
  startOrExit,
} from '@getir/service-kit';

import { buildOrderService } from './bootstrap.js';
import { CATALOG_CALL_TIMEOUT_MS, SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { GrpcCatalogPricing } from './infrastructure/catalog/grpc-catalog-pricing.js';
import { openOrderStore } from './infrastructure/order-store.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

// Acilis adimlari (veri kaynagi, indeksler, port) sarilir: biri basarisizsa hata
// duz metin yigin izi yerine tek satir fatal JSON olarak yazilir ve process kapanir.
const { handle, store } = await startOrExit(
  async () => {
    const opened = await openOrderStore(env.mongo, logger);
    // Fiyatlar catalog'dan (T7.2). Istemci tembel baglanir: catalog henuz
    // ayakta degilse acilis durmaz, ilk taslak istegi SERVICE_UNAVAILABLE alir.
    const catalog = new GrpcCatalogPricing(env.CATALOG_GRPC_ADDR, CATALOG_CALL_TIMEOUT_MS);
    const server = await startGrpcServer({
      serviceName: SERVICE_NAME,
      host: env.GRPC_HOST,
      port: env.ORDER_GRPC_PORT,
      shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
      logger,
      services: [buildOrderService({ logger, store: opened, catalog })],
      // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti
      // kesilmesin. Once giden istemci, veritabani EN SON (proje kurali).
      onShutdown: async () => {
        catalog.close();
        await opened.close();
      },
    });
    return { handle: server, store: opened };
  },
  { logger },
);

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

// Depo bilincli olarak gunluge yaziliyor: "siparisim neden kayboldu?" sorusunun
// ilk cevabi hangi modda calisildigidir (bellek modu yeniden baslayinca unutur).
logger.info(
  { port: handle.port, mock: env.MOCK, storage: store.name, catalog: env.CATALOG_GRPC_ADDR },
  'siparis servisi hazir',
);
