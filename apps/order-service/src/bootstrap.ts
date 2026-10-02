/**
 * Bagimlilik kurulumu - elle (DI framework yok).
 */

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import type { EventPublisher } from '@getir/event-bus';
import { orderV1 } from '@getir/proto';
import type { GrpcServiceRegistration } from '@getir/service-kit';

import { createCancelOrder } from './application/cancel-order.js';
import type { CatalogPricing } from './application/catalog-pricing.js';
import { createConfirmPayment } from './application/confirm-payment.js';
import { createCreateDraftOrder } from './application/create-draft-order.js';
import { createCreateOrder } from './application/create-order.js';
import { createGetOrder } from './application/get-order.js';
import { createListMyOrders } from './application/list-my-orders.js';
import { createRelayOutbox } from './application/relay-outbox.js';
import type { Payments } from './application/payments.js';
import type { RiskAssessment } from './application/risk-assessment.js';
import type { StockReservations } from './application/stock-reservations.js';
import {
  DEFAULT_RESERVATION_TTL_SECONDS,
  ORDER_SERVICE_FULL_NAME,
  OUTBOX_BATCH_SIZE,
  OUTBOX_POLL_INTERVAL_MS,
} from './config/constants.js';
import type { OrderHistoryReader } from './domain/order-history-reader.js';
import type { OrderOutbox } from './domain/order-outbox.js';
import type { OrderRepository } from './domain/order-repository.js';
import { InMemoryOrderStore } from './infrastructure/memory/in-memory-order-store.js';
import { createOrderImplementation } from './interfaces/grpc/order-handlers.js';
import { startOutboxPublisher } from './interfaces/workers/outbox-publisher.js';
import type { OutboxPublisherWorker } from './interfaces/workers/outbox-publisher.js';

/** Servisin kullandigi portlar; main.ts bunlari openOrderStore'dan verir. */
export interface OrderPorts {
  readonly repository: OrderRepository;
  readonly history: OrderHistoryReader;
  /** Telafi komutu (T7.3). Yayinci bootstrap'in degil main.ts'in isidir. */
  readonly outbox: OrderOutbox;
}

export interface BootstrapOptions {
  /** Fiyat kaynagi (T7.2): uretimde catalog gRPC istemcisi, testte sahtesi. ZORUNLU. */
  readonly catalog: CatalogPricing;
  /** Saga'nin risk adimi (T7.1): uretimde risk gRPC istemcisi, testte sahtesi. ZORUNLU. */
  readonly risk: RiskAssessment;
  /** Saga'nin odeme adimi (T7.1): uretimde payment gRPC istemcisi, testte sahtesi. ZORUNLU. */
  readonly payments: Payments;
  /** Stok kilidi (T11.2): uretimde inventory gRPC istemcisi, testte sahtesi. ZORUNLU. */
  readonly stock: StockReservations;
  /** Kilidin omru (sn); verilmezse 600 (RESERVATION_TTL_SECONDS'un varsayilani). */
  readonly reservationTtlSeconds?: number;
  readonly logger?: Logger;
  /** Siparis portlari. Verilmezse bellek kullanilir (testler). */
  readonly store?: OrderPorts;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
}

function inMemoryPorts(): OrderPorts {
  const memory = new InMemoryOrderStore();
  return { repository: memory, history: memory, outbox: memory };
}

export function buildOrderService(options: BootstrapOptions): GrpcServiceRegistration {
  const { repository, history, outbox } = options.store ?? inMemoryPorts();
  const clock = options.clock ?? systemClock;
  const { stock } = options;

  const implementation = createOrderImplementation({
    createDraftOrder: createCreateDraftOrder({
      repository,
      history,
      catalog: options.catalog,
      stock,
      reservationTtlSeconds: options.reservationTtlSeconds ?? DEFAULT_RESERVATION_TTL_SECONDS,
      clock,
    }),
    createOrder: createCreateOrder({
      repository,
      history,
      risk: options.risk,
      payments: options.payments,
      stock,
      outbox,
      clock,
    }),
    confirmPayment: createConfirmPayment({
      repository,
      payments: options.payments,
      stock,
      outbox,
      clock,
    }),
    getOrder: createGetOrder({ repository }),
    listMyOrders: createListMyOrders({ history }),
    cancelOrder: createCancelOrder({ repository, stock, clock }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    name: ORDER_SERVICE_FULL_NAME,
    definition: orderV1.OrderServiceService,
    implementation,
  };
}

export interface EventPublishingOptions {
  readonly outbox: OrderOutbox;
  /** Uretimde Redis Streams (event-bus), testte bellek ici yayinci. */
  readonly publisher: EventPublisher;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly intervalMs?: number;
  readonly batchSize?: number;
}

/**
 * Outbox yayincisini kurar ve baslatir (T7.3). Kompozisyon burada: isci
 * (interfaces/workers) use-case'i (application) calistirir; main.ts yalnizca
 * Redis baglantisini acip bunu cagirir, kapanista durdurur.
 */
export function startEventPublishing(options: EventPublishingOptions): OutboxPublisherWorker {
  const batchSize = options.batchSize ?? OUTBOX_BATCH_SIZE;
  const relay = createRelayOutbox({
    outbox: options.outbox,
    publisher: options.publisher,
    clock: options.clock ?? systemClock,
    batchSize,
  });
  return startOutboxPublisher({
    relay,
    intervalMs: options.intervalMs ?? OUTBOX_POLL_INTERVAL_MS,
    batchSize,
    logger: options.logger,
  });
}
