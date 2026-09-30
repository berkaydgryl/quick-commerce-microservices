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
import { createReserveStock } from './application/reserve-stock.js';
import { INVENTORY_SERVICE_FULL_NAME } from './config/constants.js';
import type { StockPorts } from './domain/stock-ports.js';
import { STOCK_LEVELS } from './infrastructure/fixtures/stock-levels.js';
import { createInMemoryStock } from './infrastructure/memory/in-memory-stock.js';
import { createInventoryImplementation } from './interfaces/grpc/inventory-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** Sayaclar ve rezervasyon. Verilmezse bellekteki demo stogu (MOCK modu). */
  readonly stock?: StockPorts;
  /** Rezervasyonun "simdi"si; verilmezse sistem saati (testler sabit saat verir). */
  readonly clock?: Clock;
}

/** Servisin gRPC'ye kayitli hali; startGrpcServer bunu oldugu gibi alir. */
export function buildInventoryService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const stock = options.stock ?? createInMemoryStock(STOCK_LEVELS);

  const implementation = createInventoryImplementation({
    checkAvailability: createCheckAvailability({
      counters: stock.counters,
      recoverCounters: stock.recoverCounters,
    }),
    reserveStock: createReserveStock({
      reservations: stock.reservations,
      recoverCounters: stock.recoverCounters,
      clock: options.clock ?? systemClock,
      logger: options.logger ?? silentLogger,
    }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    name: INVENTORY_SERVICE_FULL_NAME,
    definition: inventoryV1.InventoryServiceService,
    implementation,
  };
}
