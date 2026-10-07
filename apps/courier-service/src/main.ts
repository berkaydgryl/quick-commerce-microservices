/**
 * Kurye servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/courier-service build
 *   pnpm --filter @getir/courier-service start      (kok .env varsa okunur)
 *
 * Depo MOCK ile secilir: MOCK=true -> demo kuryeleriyle dolu bellek, aksi
 * halde COURIER_MONGO_URI zorunlu ve kuryeler kendi veritabaninin (D14)
 * `couriers` koleksiyonundadir (pnpm seed ile dolar).
 *
 * Tick (T13.3): her COURIER_TICK_MS'de rotalar bu ana getirilir; paket alindi
 * ve teslim edildi olaylari stream:events'e yayinlanir, teslimde kurye bosa
 * cikar. MOCK=false iken REDIS_URL zorunlu (tek lider, olaylar, canli konum);
 * MOCK=true iken tek ornek hep lider ve olaylar yayinlanmaz.
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/courier/v1/courier.proto \
 *     -d '{"order_id":"ord_...","market_id":"mkt_migros-jet-moda","delivery_location":{"lat":40.99,"lng":29.03}}' \
 *     localhost:50056 getir.courier.v1.CourierService/AssignCourier
 *   grpcurl ... -d '{"order_id":"ord_..."}' localhost:50056 getir.courier.v1.CourierService/GetTracking
 */

import { systemClock } from '@getir/core';
import {
  createLogger,
  installProcessHandlers,
  startGrpcServer,
  startOrExit,
} from '@getir/service-kit';

import { buildAdvanceRoutes, buildCourierService } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { tickTiming } from './config/tick-timing.js';
import { openCourierStore } from './infrastructure/courier-store.js';
import { openRouteMotion } from './infrastructure/route-motion.js';
import { startRouteTicker } from './interfaces/workers/route-ticker.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });
const timing = tickTiming(env.COURIER_TICK_MS);

// Acilis adimlari (veri kaynagi, gocler, indeksler, Redis ve Lua, port)
// sarilir: biri basarisizsa hata duz metin yigin izi yerine tek satir fatal
// JSON olarak yazilir ve process kapanir.
const { handle, store, motion } = await startOrExit(
  async () => {
    const opened = await openCourierStore(env.mongo, { logger, clock: systemClock });
    const motion = await openRouteMotion(env.redis, {
      logger,
      lockTtlMs: timing.lockTtlMs,
      liveTtlMs: timing.liveTtlMs,
    }).catch(async (error: unknown) => {
      // Redis'e baglanilamadi: acilmis Mongo baglantisi askida kalmasin.
      await opened.close();
      throw error;
    });
    // Tick (T13.3): her ornekte calisir, yalnizca lider ilerletir (M5 a).
    const ticker = startRouteTicker({
      lock: motion.lock,
      advance: buildAdvanceRoutes({
        routes: opened.routes,
        couriers: opened.repository,
        events: motion.events,
        live: motion.live,
        speedKmh: env.COURIER_SPEED_KMH,
        prepSeconds: env.ORDER_PREP_SECONDS,
        clock: systemClock,
      }),
      intervalMs: timing.intervalMs,
      budgetMs: timing.budgetMs,
      logger,
    });
    const server = await startGrpcServer({
      serviceName: SERVICE_NAME,
      host: env.GRPC_HOST,
      port: env.COURIER_GRPC_PORT,
      shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
      // Izler (D15): adres yoksa olusur ve tasinir, disari gonderilmez.
      otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      logger,
      services: [
        buildCourierService({
          logger,
          couriers: opened.repository,
          markets: opened.markets,
          routes: opened.routes,
          movingRoutes: opened.routes,
          speedKmh: env.COURIER_SPEED_KMH,
          prepSeconds: env.ORDER_PREP_SECONDS,
        }),
      ],
      // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti kesilmesin.
      // Once tick (suren tur biter, lider kilidi birakir), sonra Redis, Mongo EN SON.
      onShutdown: async () => {
        try {
          await ticker.stop();
          await motion.close();
        } finally {
          // Redis kapanirken hata olsa da Mongo birakilir.
          await opened.close();
        }
      },
    });
    return { handle: server, store: opened, motion };
  },
  { logger },
);

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

logger.info(
  {
    port: handle.port,
    mock: env.MOCK,
    storage: store.name,
    motion: motion.name,
    tickMs: env.COURIER_TICK_MS,
  },
  'kurye servisi hazir',
);
