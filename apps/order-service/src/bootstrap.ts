/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import { orderV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createCancelOrder } from './application/cancel-order.js';
import type { CatalogPricing } from './application/catalog-pricing.js';
import { createConfirmPayment } from './application/confirm-payment.js';
import { createCreateDraftOrder } from './application/create-draft-order.js';
import { createCreateOrder } from './application/create-order.js';
import { createGetOrder } from './application/get-order.js';
import { createListMyOrders } from './application/list-my-orders.js';
import type { Payments } from './application/payments.js';
import type { RiskAssessment } from './application/risk-assessment.js';
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
  /** Fiyat kaynagi (T7.2): uretimde catalog gRPC istemcisi, testte sahtesi. ZORUNLU. */
  readonly catalog: CatalogPricing;
  /** Saga'nin risk adimi (T7.1): uretimde risk gRPC istemcisi, testte sahtesi. ZORUNLU. */
  readonly risk: RiskAssessment;
  /** Saga'nin odeme adimi (T7.1): uretimde payment gRPC istemcisi, testte sahtesi. ZORUNLU. */
  readonly payments: Payments;
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

export function buildOrderService(options: BootstrapOptions): GrpcServiceRegistration {
  const { repository, history } = options.store ?? inMemoryPorts();
  const clock = options.clock ?? systemClock;

  const implementation = createOrderImplementation({
    createDraftOrder: createCreateDraftOrder({
      repository,
      history,
      catalog: options.catalog,
      clock,
    }),
    createOrder: createCreateOrder({
      repository,
      history,
      risk: options.risk,
      payments: options.payments,
      clock,
    }),
    confirmPayment: createConfirmPayment({ repository, payments: options.payments, clock }),
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
