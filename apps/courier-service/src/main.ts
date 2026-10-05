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
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/courier/v1/courier.proto \
 *     -d '{"order_id":"ord_...","market_id":"mkt_migros-jet-moda","delivery_location":{"lat":40.99,"lng":29.03}}' \
 *     localhost:50056 getir.courier.v1.CourierService/AssignCourier
 */

import { systemClock } from '@getir/core';
import {
  createLogger,
  installProcessHandlers,
  startGrpcServer,
  startOrExit,
} from '@getir/service-kit';

import { buildCourierService } from './bootstrap.js';
import { SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { openCourierStore } from './infrastructure/courier-store.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

// Acilis adimlari (veri kaynagi, gocler, indeksler, port) sarilir: biri
// basarisizsa hata duz metin yigin izi yerine tek satir fatal JSON olarak
// yazilir ve process kapanir.
const { handle, store } = await startOrExit(
  async () => {
    const opened = await openCourierStore(env.mongo, { logger, clock: systemClock });
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
          speedKmh: env.COURIER_SPEED_KMH,
        }),
      ],
      // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti kesilmesin.
      onShutdown: () => opened.close(),
    });
    return { handle: server, store: opened };
  },
  { logger },
);

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

logger.info({ port: handle.port, mock: env.MOCK, storage: store.name }, 'kurye servisi hazir');
