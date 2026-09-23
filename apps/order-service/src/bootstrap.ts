/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { orderV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createCancelOrder } from './application/cancel-order.js';
import { createCreateDraftOrder } from './application/create-draft-order.js';
import { createCreateOrder } from './application/create-order.js';
import { createGetOrder } from './application/get-order.js';
import { createListMyOrders } from './application/list-my-orders.js';
import { ORDER_SERVICE_FULL_NAME } from './config/constants.js';
import type { OrderHistoryReader } from './domain/order-history-reader.js';
import type { OrderRepository } from './domain/order-repository.js';
import { InMemoryOrderStore } from './infrastructure/memory/in-memory-order-store.js';
import { createOrderImplementation } from './interfaces/grpc/order-handlers.js';

/** Servisin kullandigi iki port; main.ts bunlari openOrderStore'dan verir. */
export interface OrderPorts {
  readonly repository: OrderRepository;
  readonly history: OrderHistoryReader;
}

export interface BootstrapOptions {
  readonly logger?: Logger;
  /** Siparis portlari. Verilmezse bellek kullanilir (testler). */
  readonly store?: OrderPorts;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
}

function inMemoryPorts(): OrderPorts {
  const memory = new InMemoryOrderStore();
  return { repository: memory, history: memory };
}

export function buildOrderService(options: BootstrapOptions = {}): GrpcServiceRegistration {
  const { repository, history } = options.store ?? inMemoryPorts();
  const clock = options.clock ?? systemClock;

  const implementation = createOrderImplementation({
    createDraftOrder: createCreateDraftOrder({ repository, clock }),
    createOrder: createCreateOrder({ repository, clock }),
    getOrder: createGetOrder({ repository }),
    listMyOrders: createListMyOrders({ history }),
    cancelOrder: createCancelOrder({ repository, clock }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    name: ORDER_SERVICE_FULL_NAME,
    definition: orderV1.OrderServiceService,
    implementation,
  };
}
