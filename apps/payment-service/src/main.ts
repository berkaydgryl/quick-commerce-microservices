/**
 * Odeme servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/payment-service build
 *   pnpm --filter @getir/payment-service start      (kok .env varsa okunur)
 *
 * Depo MOCK ile secilir: MOCK=true -> bellek (Mongo ve Redis gerekmez, yeniden
 * baslayinca unutur, olay dinleme kapali), aksi halde PAYMENT_MONGO_URI ve
 * REDIS_URL zorunlu: odemeler kendi veritabaninin (D14) `payments`
 * koleksiyonuna yazilir, siparis saga'sinin iade komutlari
 * (payment.refund_requested, T7.4) ve iptal komutu (payment.cancel_requested, T11.2 PR 3)
 * stream:events'ten dinlenir.
 * Saglayici her iki modda mock'tur: test kartlari README'de.
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/payment/v1/payment.proto \
 *     -d '{...}' localhost:50054 getir.payment.v1.PaymentService/Charge
 */

import { hostname } from 'node:os';

import type { Logger } from '@getir/core';
import { RedisStreamsConsumer } from '@getir/event-bus';
import { connectRedis } from '@getir/redis-kit';
import type { RedisEnv } from '@getir/redis-kit';
import {
  createLogger,
  installProcessHandlers,
  startGrpcServer,
  startOrExit,
} from '@getir/service-kit';

import { buildPaymentService, subscribePaymentEvents } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import type { PaymentRepository } from './domain/payment-repository.js';
import { openPaymentStore } from './infrastructure/payment-store.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

/** Tuketici adindaki makine adi parcasinin en uzun hali (ad en fazla 128 karakter). */
const CONSUMER_HOST_MAX_LENGTH = 100;

/** Kapanista cagrilir; MOCK modunda yapacak is yok. */
interface EventConsuming {
  readonly name: 'redis' | 'kapali (MOCK)';
  stop(): Promise<void>;
}

/**
 * Olay dinleme (T7.4): iade komutlarini stream:events'ten dinler. MOCK
 * modunda Redis yoktur, dinleme kapalidir. Tuketici adi surece tekildir
 * (makine + pid): payment'in kopyalari ayni grupta isi paylasir.
 */
async function openEventConsuming(
  redisEnv: RedisEnv | undefined,
  repository: PaymentRepository,
  log: Logger,
): Promise<EventConsuming> {
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
  });
  subscribePaymentEvents(consumer, { repository });
  await consumer.start();
  return { name: 'redis', stop: () => consumer.stop() };
}

// Acilis adimlari (veri kaynagi, indeksler, port) sarilir: biri basarisizsa hata
// duz metin yigin izi yerine tek satir fatal JSON olarak yazilir ve process kapanir.
const { handle, store, events } = await startOrExit(
  async () => {
    const opened = await openPaymentStore(env.mongo, logger);
    const consuming = await openEventConsuming(env.redis, opened.repository, logger).catch(
      async (error: unknown) => {
        // Redis'e baglanilamadi: acilmis Mongo baglantisi askida kalmasin.
        await opened.close();
        throw error;
      },
    );
    const server = await startGrpcServer({
      serviceName: SERVICE_NAME,
      host: env.GRPC_HOST,
      port: env.PAYMENT_GRPC_PORT,
      shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
      // Izler (D15): adres yoksa olusur ve tasinir, disari gonderilmez.
      otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      logger,
      services: [buildPaymentService({ logger, repository: opened.repository })],
      // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti kesilmesin.
      // Once olay dinleme (suren iade biter, Redis kapanir), veritabani EN SON.
      onShutdown: async () => {
        await consuming.stop();
        await opened.close();
      },
    });
    return { handle: server, store: opened, events: consuming };
  },
  { logger },
);

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

// Depo gunluge yazilir: "odemem neden kayboldu?" sorusunun ilk cevabi moddur.
logger.info(
  { port: handle.port, mock: env.MOCK, storage: store.name, events: events.name, provider: 'mock' },
  'odeme servisi hazir',
);
