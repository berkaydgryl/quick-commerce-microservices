/**
 * Stok servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/inventory-service build
 *   pnpm --filter @getir/inventory-service start      (kok .env varsa okunur)
 *
 * Kaynak MOCK ile secilir: MOCK=true -> bellek (Mongo ve Redis gerekmez),
 * aksi halde MONGO_URI ve REDIS_URL zorunlu. Stogu yazmak icin: pnpm seed
 *
 * Dogrulama (grpcurl):
 *   grpcurl -plaintext -import-path packages/proto/proto \
 *     -proto getir/inventory/v1/inventory.proto \
 *     -d '{"market_id":"mkt_migros-jet-moda","skus":["SUT-1L","KOLA-1L"]}' \
 *     localhost:50052 getir.inventory.v1.InventoryService/CheckAvailability
 */

import {
  createLogger,
  installProcessHandlers,
  startGrpcServer,
  startOrExit,
} from '@getir/service-kit';

import { buildInventoryService, buildSweepExpired } from './bootstrap.js';
import { MS_PER_SECOND, SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { openStockSource } from './infrastructure/stock-source.js';
import { startReservationSweeper } from './interfaces/workers/reservation-sweeper.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

// Acilis adimlari (depolar, tahliye denetimi, sayac seed'i, port) sarilir: biri
// basarisizsa hata tek satir fatal JSON olarak yazilir ve process kapanir.
// Sayaclar portTAN ONCE yazilir: seed bitmeden servis hazir gorunmez (ADR-03).
const { handle, source } = await startOrExit(
  async () => {
    const opened = await openStockSource(env.stores, logger, {
      lockTtlMs: env.SWEEPER_LOCK_TTL_SECONDS * MS_PER_SECOND,
    });
    // Supurucu (T10.3): her ornekte calisir, yalnizca lider supurur (B25).
    const sweeper = startReservationSweeper({
      lock: opened.leader,
      sweep: buildSweepExpired({ stock: opened, markets: opened.markets, logger }),
      intervalMs: env.SWEEPER_INTERVAL_MS,
      logger,
    });
    const server = await startGrpcServer({
      serviceName: SERVICE_NAME,
      host: env.GRPC_HOST,
      port: env.INVENTORY_GRPC_PORT,
      shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
      logger,
      services: [buildInventoryService({ logger, stock: opened })],
      // Sunucu kapandiktan SONRA: devam eden cagrilar bitmeden baglanti kesilmesin.
      // Once supurucu (suren tur biter, lider kilidi birakir), depolar EN SON.
      onShutdown: async () => {
        await sweeper.stop();
        await opened.close();
      },
    });
    return { handle: server, source: opened };
  },
  { logger },
);

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

logger.info(
  { port: handle.port, mock: env.MOCK, source: source.name, counters: source.seeded },
  'stok servisi hazir',
);
