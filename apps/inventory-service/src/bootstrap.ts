/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 *
 * Tek is: hangi uygulamanin hangi arayuzu karsiladigini SECMEK ve parcalari
 * birbirine baglamak. Stok kaynagi infrastructure/stock-source.ts'te acilir.
 */

import { silentLogger, systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createCheckAvailability } from './application/check-availability.js';
import { createCommitReservation } from './application/commit-reservation.js';
import { createExtendReservation } from './application/extend-reservation.js';
import { createReleaseReservation } from './application/release-reservation.js';
import { createReserveStock } from './application/reserve-stock.js';
import { createShortenReservation } from './application/shorten-reservation.js';
import { createSweepExpired } from './application/sweep-expired.js';
import type { SweepExpired } from './application/sweep-expired.js';
import {
  DEFAULT_RESERVATION_MAX_EXTENSIONS,
  INVENTORY_SERVICE_FULL_NAME,
  SWEEP_BATCH_SIZE,
  SWEEPER_MARKET_REFRESH_MS,
} from './config/constants.js';
import type { StockPorts } from './domain/stock-ports.js';
import type { StockMarketSource } from './domain/stock.js';
import { STOCK_LEVELS } from './infrastructure/fixtures/stock-levels.js';
import { createInMemoryStock } from './infrastructure/memory/in-memory-stock.js';
import { createInventoryImplementation } from './interfaces/grpc/inventory-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** Sayaclar, rezervasyon, defter ve onay yazimi. Verilmezse bellekteki demo stogu (MOCK modu). */
  readonly stock?: StockPorts;
  /** Rezervasyonun "simdi"si; verilmezse sistem saati (testler sabit saat verir). */
  readonly clock?: Clock;
  /** Rezervasyon basina en cok uzatma (RESERVATION_MAX_EXTENSIONS, T11.3). */
  readonly maxExtensions?: number;
}

/** Servisin gRPC'ye kayitli hali; startGrpcServer bunu oldugu gibi alir. */
export function buildInventoryService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const stock = options.stock ?? createInMemoryStock(STOCK_LEVELS);
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? silentLogger;

  const implementation = createInventoryImplementation({
    checkAvailability: createCheckAvailability({
      counters: stock.counters,
      recoverCounters: stock.recoverCounters,
    }),
    reserveStock: createReserveStock({
      reservations: stock.reservations,
      recoverCounters: stock.recoverCounters,
      clock,
      logger,
    }),
    releaseReservation: createReleaseReservation({
      reservations: stock.reservations,
      ledger: stock.ledger,
      clock,
      logger,
    }),
    commitReservation: createCommitReservation({
      reservations: stock.reservations,
      committer: stock.committer,
      ledger: stock.ledger,
      clock,
      logger,
    }),
    extendReservation: createExtendReservation({
      reservations: stock.reservations,
      ledger: stock.ledger,
      clock,
      logger,
      maxExtensions: options.maxExtensions ?? DEFAULT_RESERVATION_MAX_EXTENSIONS,
    }),
    shortenReservation: createShortenReservation({
      reservations: stock.reservations,
      clock,
      logger,
    }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    name: INVENTORY_SERVICE_FULL_NAME,
    definition: inventoryV1.InventoryServiceService,
    implementation,
  };
}

export interface SweepOptions {
  readonly stock: Pick<StockPorts, 'reservations' | 'ledger'>;
  readonly markets: StockMarketSource;
  readonly logger: Logger;
  readonly clock?: Clock;
}

/** Supurucunun turu (T10.3): suresi dolanlari geri verir; isci main.ts'te baslar. */
export function buildSweepExpired(options: SweepOptions): SweepExpired {
  return createSweepExpired({
    markets: options.markets,
    reservations: options.stock.reservations,
    ledger: options.stock.ledger,
    clock: options.clock ?? systemClock,
    logger: options.logger,
    batchSize: SWEEP_BATCH_SIZE,
    marketRefreshMs: SWEEPER_MARKET_REFRESH_MS,
  });
}
