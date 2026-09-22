/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { orderV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createCreateDraftOrder } from './application/create-draft-order.js';
import { createCreateOrder } from './application/create-order.js';
import { ORDER_SERVICE_FULL_NAME } from './config/constants.js';
import type { OrderRepository } from './domain/order-repository.js';
import { InMemoryOrderRepository } from './infrastructure/in-memory-order-repository.js';
import { createOrderImplementation } from './interfaces/grpc/order-handlers.js';

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** Siparis deposu. Verilmezse bellek kullanilir; T4.5'te Mongo gelecek. */
  readonly repository?: OrderRepository;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
}

export function buildOrderService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const repository = options.repository ?? new InMemoryOrderRepository();
  const clock = options.clock ?? systemClock;

  const implementation = createOrderImplementation({
    createDraftOrder: createCreateDraftOrder({ repository, clock }),
    createOrder: createCreateOrder({ repository, clock }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    name: ORDER_SERVICE_FULL_NAME,
    definition: orderV1.OrderServiceService,
    implementation,
  };
}
