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
import type { CourierAssignment } from './application/courier-assignment.js';
import { createCreateDraftOrder } from './application/create-draft-order.js';
import { createCreateOrder } from './application/create-order.js';
import { createDispatchCouriers } from './application/dispatch-couriers.js';
import { createGetOrder } from './application/get-order.js';
import { createListMyOrders } from './application/list-my-orders.js';
import { createRelayOutbox } from './application/relay-outbox.js';
import { createSweepExpiredReservations } from './application/sweep-expired-reservations.js';
import type { Payments } from './application/payments.js';
import type { RiskAssessment } from './application/risk-assessment.js';
import type { LockPolicy } from './application/lock-timing.js';
import type { StockReservations } from './application/stock-reservations.js';
import {
  COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  COURIER_DISPATCH_BATCH_SIZE,
  COURIER_DISPATCH_INTERVAL_MS,
  COURIER_RETRY_DELAY_MS,
  DEFAULT_MEDIUM_RISK_RESERVATION_SECONDS,
  DEFAULT_RESERVATION_EXTEND_SECONDS,
  DEFAULT_RESERVATION_TTL_SECONDS,
  ORDER_SERVICE_FULL_NAME,
  DEFAULT_ORDER_SWEEPER_INTERVAL_MS,
  ORDER_SWEEPER_BATCH_SIZE,
  OUTBOX_BATCH_SIZE,
  OUTBOX_POLL_INTERVAL_MS,
} from './config/constants.js';
import type { AwaitingCourierFinder } from './domain/awaiting-courier-finder.js';
import type { ExpiredOrderFinder } from './domain/expired-order-finder.js';
import type { OrderHistoryReader } from './domain/order-history-reader.js';
import type { OrderOutbox } from './domain/order-outbox.js';
import type { OrderRepository } from './domain/order-repository.js';
import { InMemoryOrderStore } from './infrastructure/memory/in-memory-order-store.js';
import { createOrderImplementation } from './interfaces/grpc/order-handlers.js';
import { startCourierDispatcher } from './interfaces/workers/courier-dispatcher.js';
import type { CourierDispatcher } from './interfaces/workers/courier-dispatcher.js';
import { startOutboxPublisher } from './interfaces/workers/outbox-publisher.js';
import type { OutboxPublisherWorker } from './interfaces/workers/outbox-publisher.js';
import { startReservationSweeper } from './interfaces/workers/reservation-sweeper.js';
import type { ReservationSweeper } from './interfaces/workers/reservation-sweeper.js';

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
  /**
   * Banda gore kilit ve odeme oncesi uzatma (T11.3); verilmezse 120 ve 60 sn
   * (RESERVATION_TTL_MEDIUM_RISK_SECONDS, RESERVATION_EXTEND_SECONDS).
   */
  readonly lockPolicy?: LockPolicy;
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
  const lockPolicy = options.lockPolicy ?? {
    mediumRiskSeconds: DEFAULT_MEDIUM_RISK_RESERVATION_SECONDS,
    extendSeconds: DEFAULT_RESERVATION_EXTEND_SECONDS,
  };

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
      lockPolicy,
    }),
    confirmPayment: createConfirmPayment({
      repository,
      payments: options.payments,
      stock,
      outbox,
      clock,
      lockPolicy,
    }),
    getOrder: createGetOrder({ repository }),
    listMyOrders: createListMyOrders({ history }),
    cancelOrder: createCancelOrder({ repository, payments: options.payments, stock, clock }),
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

export interface ReservationSweepingOptions {
  readonly expired: ExpiredOrderFinder;
  readonly repository: OrderRepository;
  readonly payments: Payments;
  readonly stock: StockReservations;
  /** Iade komutu: dogrudan iade basarisizsa kalici olarak yazilir (T7.3). */
  readonly outbox: OrderOutbox;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly intervalMs?: number;
}

/**
 * Kilidi dolan siparisleri kapatan supurucuyu kurar ve baslatir (T11.2 PR 2).
 * Depo hangisi olursa olsun calisir (MOCK'ta bellek); Redis gerekmez.
 */
export function startReservationSweeping(options: ReservationSweepingOptions): ReservationSweeper {
  const sweep = createSweepExpiredReservations({
    expired: options.expired,
    repository: options.repository,
    payments: options.payments,
    stock: options.stock,
    outbox: options.outbox,
    clock: options.clock ?? systemClock,
    batchSize: ORDER_SWEEPER_BATCH_SIZE,
  });
  return startReservationSweeper({
    sweep,
    intervalMs: options.intervalMs ?? DEFAULT_ORDER_SWEEPER_INTERVAL_MS,
    logger: options.logger,
  });
}

export interface CourierDispatchingOptions {
  readonly awaiting: AwaitingCourierFinder;
  readonly repository: OrderRepository;
  /** courier-svc: uretimde gRPC istemcisi, testte sahtesi. */
  readonly courier: CourierAssignment;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly intervalMs?: number;
}

/**
 * Odenen siparise kurye atayan isciyi kurar ve baslatir (T13.1 PR 2). Depo
 * hangisi olursa olsun calisir (MOCK'ta bellek); courier adresine gider.
 */
export function startCourierDispatching(options: CourierDispatchingOptions): CourierDispatcher {
  const dispatch = createDispatchCouriers({
    awaiting: options.awaiting,
    repository: options.repository,
    courier: options.courier,
    clock: options.clock ?? systemClock,
    batchSize: COURIER_DISPATCH_BATCH_SIZE,
    retryDelayMs: COURIER_RETRY_DELAY_MS,
    writeAttempts: COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  });
  return startCourierDispatcher({
    dispatch,
    intervalMs: options.intervalMs ?? COURIER_DISPATCH_INTERVAL_MS,
    logger: options.logger,
  });
}
