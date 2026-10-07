/**
 * Siparis servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/order-service build
 *   pnpm --filter @getir/order-service start      (kok .env varsa okunur)
 *
 * Depo MOCK ile secilir: MOCK=true -> bellek (Mongo ve Redis gerekmez, olay
 * yayinci ve dinleme kapali), aksi halde ORDER_MONGO_URI ve REDIS_URL zorunlu:
 * siparisler kendi veritabaninin (D14) `orders`'ina, olaylari ayni
 * transaction'da `outbox`'a yazilir ve yayinci onlari stream:events'e basar
 * (T7.3); kurye kilometre taslari (courier.picked_up, courier.delivered;
 * T14.3) ayni akistan dinlenir.
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/order/v1/order.proto \
 *     -d '{...}' localhost:50053 getir.order.v1.OrderService/CreateDraftOrder
 */

import { hostname } from 'node:os';

import {
  DEFAULT_DELIVERY_SETTINGS,
  RedisStreamsConsumer,
  RedisStreamsPublisher,
} from '@getir/event-bus';
import { connectRedis } from '@getir/redis-kit';
import type { RedisEnv } from '@getir/redis-kit';
import type { Logger } from '@getir/core';
import {
  createLogger,
  installProcessHandlers,
  startGrpcServer,
  startOrExit,
} from '@getir/service-kit';

import {
  buildOrderService,
  startCourierDispatching,
  startEventPublishing,
  startReservationSweeping,
  subscribeOrderEvents,
} from './bootstrap.js';
import type { OrderOutbox } from './domain/order-outbox.js';
import type { OrderRepository } from './domain/order-repository.js';
import {
  CATALOG_CALL_TIMEOUT_MS,
  COURIER_CALL_TIMEOUT_MS,
  COURIER_EVENT_RETRY_WINDOW_MS,
  INVENTORY_CALL_TIMEOUT_MS,
  PAYMENT_CALL_TIMEOUT_MS,
  RISK_CALL_TIMEOUT_MS,
  SERVICE_NAME,
} from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { GrpcCatalogPricing } from './infrastructure/catalog/grpc-catalog-pricing.js';
import { GrpcCourierAssignment } from './infrastructure/courier/grpc-courier-assignment.js';
import { DEPENDENCY, dependencyResilience } from './infrastructure/grpc-resilience.js';
import { GrpcStockReservations } from './infrastructure/inventory/grpc-stock-reservations.js';
import { openOrderStore } from './infrastructure/order-store.js';
import { GrpcPayments } from './infrastructure/payment/grpc-payments.js';
import { GrpcRiskAssessment } from './infrastructure/risk/grpc-risk-assessment.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

/** Olay yayini ya da dinlemesi; kapanista cagrilir, MOCK modunda yapacak is yok. */
interface EventChannel {
  readonly name: 'redis' | 'kapali (MOCK)';
  stop(): Promise<void>;
}

/** Tuketici adindaki makine adi parcasinin en uzun hali (ad en fazla 128 karakter). */
const CONSUMER_HOST_MAX_LENGTH = 100;

/**
 * Olay yayini (T7.3): Redis'e baglanir, outbox yayincisini baslatir. MOCK
 * modunda Redis yoktur; olaylar bellekte yazilir ama yayinlanmaz.
 * Kapanis sirasi: once isci (suren tur biter), sonra Redis.
 */
async function openEventPublishing(
  redisEnv: RedisEnv | undefined,
  outbox: OrderOutbox,
  log: Logger,
): Promise<EventChannel> {
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

/**
 * Olay dinleme (T14.3): kurye kilometre taslarini stream:events'ten dinler.
 * MOCK modunda Redis yoktur, dinleme kapalidir. Tuketici adi surece tekildir
 * (makine + pid): order'in kopyalari ayni grupta isi paylasir.
 */
async function openEventConsuming(
  redisEnv: RedisEnv | undefined,
  repository: OrderRepository,
  log: Logger,
): Promise<EventChannel> {
  if (redisEnv === undefined) {
    return { name: 'kapali (MOCK)', stop: () => Promise.resolve() };
  }
  const consumer = new RedisStreamsConsumer({
    connect: () =>
      connectRedis({
        url: redisEnv.REDIS_URL,
        connectTimeoutMs: redisEnv.REDIS_CONNECT_TIMEOUT_MS,
        name: `${SERVICE_NAME}-events`,
        logger: log,
      }),
    consumerName: `${hostname().slice(0, CONSUMER_HOST_MAX_LENGTH)}-${process.pid}`,
    logger: log,
    // Kurye yazimini bekleyen olay erken olu olaylara dusmesin (constants.ts): 10 dk, 20 teslim.
    delivery: {
      maxDeliveries: Math.ceil(
        COURIER_EVENT_RETRY_WINDOW_MS / DEFAULT_DELIVERY_SETTINGS.claimIdleMs,
      ),
    },
  });
  subscribeOrderEvents(consumer, { repository });
  await consumer.start();
  return { name: 'redis', stop: () => consumer.stop() };
}

// Acilis adimlari (veri kaynagi, indeksler, port) sarilir: biri basarisizsa hata
// duz metin yigin izi yerine tek satir fatal JSON olarak yazilir ve process kapanir.
const { handle, store, events, consuming } = await startOrExit(
  async () => {
    const opened = await openOrderStore(env.mongo, logger, env.NODE_ENV);
    const publishing = await openEventPublishing(env.redis, opened.outbox, logger).catch(
      async (error: unknown) => {
        // Redis'e baglanilamadi: acilmis Mongo baglantisi askida kalmasin.
        await opened.close();
        throw error;
      },
    );
    const consuming = await openEventConsuming(env.redis, opened.repository, logger).catch(
      async (error: unknown) => {
        // Yayin acildi ama dinleme acilamadi: ikisi de askida kalmasin.
        await publishing.stop();
        await opened.close();
        throw error;
      },
    );
    // Fiyatlar catalog'dan (T7.2). Istemci tembel baglanir: catalog henuz
    // ayakta degilse acilis durmaz, ilk taslak istegi SERVICE_UNAVAILABLE alir.
    // Her bagimli servise devre kesici, idempotent cagrilara yeniden deneme (D17).
    const catalog = new GrpcCatalogPricing(
      env.CATALOG_GRPC_ADDR,
      CATALOG_CALL_TIMEOUT_MS,
      dependencyResilience(DEPENDENCY.CATALOG, logger),
    );
    // Saga (T7.1): istemciler catalog'unki gibi tembel baglanir; risk ya da
    // payment kapaliysa CreateOrder SERVICE_UNAVAILABLE alir, acilis durmaz.
    const risk = new GrpcRiskAssessment(
      env.RISK_GRPC_ADDR,
      RISK_CALL_TIMEOUT_MS,
      dependencyResilience(DEPENDENCY.RISK, logger),
    );
    const payments = new GrpcPayments(
      env.PAYMENT_GRPC_ADDR,
      PAYMENT_CALL_TIMEOUT_MS,
      dependencyResilience(DEPENDENCY.PAYMENT, logger),
    );
    // Stok kilidi (T11.2): tembel baglanir; inventory kapaliysa taslak ve siparis
    // SERVICE_UNAVAILABLE alir, acilis durmaz.
    const stock = new GrpcStockReservations(
      env.INVENTORY_GRPC_ADDR,
      INVENTORY_CALL_TIMEOUT_MS,
      dependencyResilience(DEPENDENCY.INVENTORY, logger),
    );
    // Kurye atama (T13.1 PR 2): tembel baglanir; courier kapaliysa odenen
    // siparisler PAID'de bekler, isci her turda yeniden dener, acilis durmaz.
    const courier = new GrpcCourierAssignment(
      env.COURIER_GRPC_ADDR,
      COURIER_CALL_TIMEOUT_MS,
      dependencyResilience(DEPENDENCY.COURIER, logger),
    );
    const dispatcher = startCourierDispatching({
      awaiting: opened.awaitingCourier,
      repository: opened.repository,
      courier,
      logger,
    });
    // Kilidi dolan siparisleri kapatan supurucu (T11.2 PR 2): her depoda calisir.
    const sweeper = startReservationSweeping({
      expired: opened.expired,
      repository: opened.repository,
      payments,
      stock,
      outbox: opened.outbox,
      logger,
      intervalMs: env.ORDER_SWEEPER_INTERVAL_MS,
    });
    const server = await startGrpcServer({
      serviceName: SERVICE_NAME,
      host: env.GRPC_HOST,
      port: env.ORDER_GRPC_PORT,
      shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
      // Izler (D15): adres yoksa olusur ve tasinir, disari gonderilmez.
      otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      logger,
      services: [
        buildOrderService({
          logger,
          store: opened,
          catalog,
          risk,
          payments,
          stock,
          reservationTtlSeconds: env.RESERVATION_TTL_SECONDS,
          lockPolicy: {
            mediumRiskSeconds: env.RESERVATION_TTL_MEDIUM_RISK_SECONDS,
            extendSeconds: env.RESERVATION_EXTEND_SECONDS,
          },
        }),
      ],
      // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti
      // kesilmesin. Once giden istemci, veritabani EN SON (proje kurali).
      onShutdown: async () => {
        // Once olay dinleme ve isciler (suren is biter; istemcileri ve Mongo'yu
        // kullanir), sonra olay yayini (suren tur biter, Redis kapanir), sonra
        // istemciler, veritabani EN SON: yayinci outbox'i Mongo'dan okur.
        await consuming.stop();
        await dispatcher.stop();
        await sweeper.stop();
        await publishing.stop();
        catalog.close();
        risk.close();
        payments.close();
        stock.close();
        courier.close();
        await opened.close();
      },
    });
    return { handle: server, store: opened, events: publishing, consuming };
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
    consuming: consuming.name,
    catalog: env.CATALOG_GRPC_ADDR,
    risk: env.RISK_GRPC_ADDR,
    payment: env.PAYMENT_GRPC_ADDR,
    inventory: env.INVENTORY_GRPC_ADDR,
    courier: env.COURIER_GRPC_ADDR,
    sweeperIntervalMs: env.ORDER_SWEEPER_INTERVAL_MS,
  },
  'siparis servisi hazir',
);
