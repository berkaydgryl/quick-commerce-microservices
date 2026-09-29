/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 *
 * Tek is: hangi uygulamanin hangi arayuzu karsiladigini SECMEK ve parcalari
 * birbirine baglamak. Stok kaynagi infrastructure/stock-source.ts'te acilir.
 */

import type { Logger } from '@getir/core';
import { inventoryV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createCheckAvailability } from './application/check-availability.js';
import { INVENTORY_SERVICE_FULL_NAME } from './config/constants.js';
import type { StockCounterReader } from './domain/stock.js';
import { STOCK_LEVELS } from './infrastructure/fixtures/stock-levels.js';
import { InMemoryStockCounters } from './infrastructure/memory/in-memory-stock-counters.js';
import { createInventoryImplementation } from './interfaces/grpc/inventory-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** Sayac kaynagi. Verilmezse bellekteki demo stogu (MOCK modu). */
  readonly counters?: StockCounterReader;
}

/** Servisin gRPC'ye kayitli hali; startGrpcServer bunu oldugu gibi alir. */
export function buildInventoryService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const counters = options.counters ?? new InMemoryStockCounters(STOCK_LEVELS);

  const implementation = createInventoryImplementation({
    checkAvailability: createCheckAvailability({ counters }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    name: INVENTORY_SERVICE_FULL_NAME,
    definition: inventoryV1.InventoryServiceService,
    implementation,
  };
}
