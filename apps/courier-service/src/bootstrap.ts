/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { courierV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createAssignCourier } from './application/assign-courier.js';
import { createGetCourier } from './application/get-courier.js';
import { createLeastRecentlyAssignedStrategy } from './application/least-recently-assigned.js';
import { createReleaseCourier } from './application/release-courier.js';
import { COURIER_SERVICE_FULL_NAME } from './config/constants.js';
import type { CourierRepository } from './domain/courier-repository.js';
import { InMemoryCourierStore } from './infrastructure/memory/in-memory-courier-store.js';
import { createCourierImplementation } from './interfaces/grpc/courier-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** couriers deposu; main.ts openCourierStore'dan verir. Verilmezse bos bellek (testler). */
  readonly couriers?: CourierRepository;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
}

export function buildCourierService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const logger = options.logger;
  const clock = options.clock ?? systemClock;
  const repository = options.couriers ?? new InMemoryCourierStore();

  // Use-case'ler gunlukcuyu bagimlilik olarak ALMAZ: her cagrida handler'in
  // requestId bagli gunlukcusu gecer (ctx.logger).
  return {
    name: COURIER_SERVICE_FULL_NAME,
    definition: courierV1.CourierServiceService,
    implementation: createCourierImplementation({
      assignCourier: createAssignCourier({
        repository,
        strategy: createLeastRecentlyAssignedStrategy(repository),
        clock,
      }),
      getCourier: createGetCourier(repository),
      releaseCourier: createReleaseCourier(repository),
      ...(logger === undefined ? {} : { logger }),
    }),
  };
}
