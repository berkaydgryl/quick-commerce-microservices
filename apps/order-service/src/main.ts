/**
 * Siparis servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/order-service build
 *   pnpm --filter @getir/order-service start      (kok .env varsa okunur)
 *
 * Depo MOCK ile secilir: MOCK=true -> bellek (Mongo ve Redis gerekmez, olay
 * yayinci kapali), aksi halde MONGO_URI ve REDIS_URL zorunlu: siparisler
 * `orders`'a, olaylari ayni transaction'da `outbox`'a yazilir ve yayinci
 * onlari stream:events'e basar (T7.3).
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/order/v1/order.proto \
 *     -d '{...}' localhost:50053 getir.order.v1.OrderService/CreateDraftOrder
 */

import { RedisStreamsPublisher } from '@getir/event-bus';
import { connectRedis } from '@getir/redis-kit';
import type { RedisEnv } from '@getir/redis-kit';
import type { Logger } from '@getir/core';
import {
  createLogger,
  installProcessHandlers,
  startGrpcServer,
  startOrExit,
} from '@getir/service-kit';

import { buildOrderService, startEventPublishing } from './bootstrap.js';
import type { OrderOutbox } from './domain/order-outbox.js';
import {
  CATALOG_CALL_TIMEOUT_MS,
  PAYMENT_CALL_TIMEOUT_MS,
  RISK_CALL_TIMEOUT_MS,
  SERVICE_NAME,
} from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { GrpcCatalogPricing } from './infrastructure/catalog/grpc-catalog-pricing.js';
import { openOrderStore } from './infrastructure/order-store.js';
import { GrpcPayments } from './infrastructure/payment/grpc-payments.js';
import { GrpcRiskAssessment } from './infrastructure/risk/grpc-risk-assessment.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

/** Kapanista cagrilir; MOCK modunda yapacak is yok. */
interface EventPublishing {
  readonly name: 'redis' | 'kapali (MOCK)';
  stop(): Promise<void>;
}

/**
 * Olay yayini (T7.3): Redis'e baglanir, outbox yayincisini baslatir. MOCK
 * modunda Redis yoktur; olaylar bellekte yazilir ama yayinlanmaz.
 * Kapanis sirasi: once isci (suren tur biter), sonra Redis.
 */
async function openEventPublishing(
  redisEnv: RedisEnv | undefined,
  outbox: OrderOutbox,
  log: Logger,
): Promise<EventPublishing> {
  if (redisEnv === undefined) {
    return { name: 'kapali (MOCK)', stop: () => Promise.resolve() };
  }
  const redis = await connectRedis({
    url: redisEnv.REDIS_URL,
    connectTimeoutMs: redisEnv.REDIS_CONNECT_TIMEOUT_MS,
    name: SERVICE_NAME,
    logger: log,
  });
  const worker = startEventPublishing({
    outbox,
    publisher: new RedisStreamsPublisher(redis.redis),
    logger: log,
  });
  return {
    name: 'redis',
    stop: async () => {
      await worker.stop();
      await redis.close();
    },
  };
}

// Acilis adimlari (veri kaynagi, indeksler, port) sarilir: biri basarisizsa hata
// duz metin yigin izi yerine tek satir fatal JSON olarak yazilir ve process kapanir.
const { handle, store, events } = await startOrExit(
  async () => {
    const opened = await openOrderStore(env.mongo, logger);
    const publishing = await openEventPublishing(env.redis, opened.outbox, logger).catch(
      async (error: unknown) => {
        // Redis'e baglanilamadi: acilmis Mongo baglantisi askida kalmasin.
        await opened.close();
        throw error;
      },
    );
    // Fiyatlar catalog'dan (T7.2). Istemci tembel baglanir: catalog henuz
    // ayakta degilse acilis durmaz, ilk taslak istegi SERVICE_UNAVAILABLE alir.
    const catalog = new GrpcCatalogPricing(env.CATALOG_GRPC_ADDR, CATALOG_CALL_TIMEOUT_MS);
    // Saga (T7.1): istemciler catalog'unki gibi tembel baglanir; risk ya da
    // payment kapaliysa CreateOrder SERVICE_UNAVAILABLE alir, acilis durmaz.
    const risk = new GrpcRiskAssessment(env.RISK_GRPC_ADDR, RISK_CALL_TIMEOUT_MS);
    const payments = new GrpcPayments(env.PAYMENT_GRPC_ADDR, PAYMENT_CALL_TIMEOUT_MS);
    const server = await startGrpcServer({
      serviceName: SERVICE_NAME,
      host: env.GRPC_HOST,
      port: env.ORDER_GRPC_PORT,
      shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
      logger,
      services: [buildOrderService({ logger, store: opened, catalog, risk, payments })],
      // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti
      // kesilmesin. Once giden istemci, veritabani EN SON (proje kurali).
      onShutdown: async () => {
        // Once olay yayini (suren tur biter, Redis kapanir), sonra istemciler,
        // veritabani EN SON: yayinci outbox'i Mongo'dan okur.
        await publishing.stop();
        catalog.close();
        risk.close();
        payments.close();
        await opened.close();
      },
    });
    return { handle: server, store: opened, events: publishing };
  },
  { logger },
);

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

// Depo bilincli olarak gunluge yaziliyor: "siparisim neden kayboldu?" sorusunun
// ilk cevabi hangi modda calisildigidir (bellek modu yeniden baslayinca unutur).
logger.info(
  {
    port: handle.port,
    mock: env.MOCK,
    storage: store.name,
    events: events.name,
    catalog: env.CATALOG_GRPC_ADDR,
    risk: env.RISK_GRPC_ADDR,
    payment: env.PAYMENT_GRPC_ADDR,
  },
  'siparis servisi hazir',
);
