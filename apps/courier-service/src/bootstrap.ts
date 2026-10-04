/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { courierV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createAssignCourier } from './application/assign-courier.js';
import { createGetCourier } from './application/get-courier.js';
import { createNearestAvailableStrategy } from './application/nearest-available.js';
import { createReleaseCourier } from './application/release-courier.js';
import {
  COURIER_POOL_RADIUS_METERS,
  COURIER_PROXIMITY_BAND_METERS,
  COURIER_SERVICE_FULL_NAME,
} from './config/constants.js';
import type { CourierRepository } from './domain/courier-repository.js';
import type { MarketLocator } from './domain/market-locator.js';
import { MARKET_LOCATION_SEEDS } from './infrastructure/fixtures/couriers.js';
import { InMemoryCourierStore } from './infrastructure/memory/in-memory-courier-store.js';
import { createCourierImplementation } from './interfaces/grpc/courier-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** couriers deposu; main.ts openCourierStore'dan verir. Verilmezse bos bellek (testler). */
  readonly couriers?: CourierRepository;
  /**
   * Market konumu kopyasi (T13.2); main.ts openCourierStore'dan verir.
   * Verilmezse demo marketleri bellekte (testler).
   */
  readonly markets?: MarketLocator;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
}

export function buildCourierService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const logger = options.logger;
  const clock = options.clock ?? systemClock;
  const repository = options.couriers ?? new InMemoryCourierStore();
  const markets = options.markets ?? new InMemoryCourierStore([], MARKET_LOCATION_SEEDS);

  // Use-case'ler gunlukcuyu bagimlilik olarak ALMAZ: her cagrida handler'in
  // requestId bagli gunlukcusu gecer (ctx.logger).
  return {
    name: COURIER_SERVICE_FULL_NAME,
    definition: courierV1.CourierServiceService,
    implementation: createCourierImplementation({
      assignCourier: createAssignCourier({
        repository,
        markets,
        strategy: createNearestAvailableStrategy(repository, {
          radiusMeters: COURIER_POOL_RADIUS_METERS,
          bandMeters: COURIER_PROXIMITY_BAND_METERS,
        }),
        clock,
      }),
      getCourier: createGetCourier(repository),
      releaseCourier: createReleaseCourier(repository, clock),
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}
