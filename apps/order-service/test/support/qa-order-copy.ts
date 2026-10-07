/**
 * QA (T15.2): order + payment kurulumunun ORTAK parcalari. Tek kopyali dunya (qa-payment-world.ts,
 * Shop; bellek deposu) ve iki kopyali kume (qa-order-cluster.ts; Mongo) ayni kurulumu kullanir:
 *
 *   startPayment     payment'in gRPC'si (buildPaymentService, bellek deposu, mock saglayici),
 *                    ariza katmaniyla sarili (qa-payment-faults.ts);
 *   startOrderCopy   order'in gRPC'si (buildOrderService), payment ve inventory istemcileri
 *                    (uretim dayanikliligi) ve supurucu;
 *   paymentHandlers  payment'in komut isleyicileri, uretimdeki kayitla (subscribePaymentEvents).
 */

import { silentLogger } from '@getir/core';
import type { Clock } from '@getir/core';
import type { EventEnvelope, EventHandler, EventOutcome } from '@getir/event-bus';
import { startTestGrpcServer } from '@getir/service-kit/testing';

import {
  buildPaymentService,
  subscribePaymentEvents,
} from '../../../payment-service/src/bootstrap.js';
import type { InMemoryPaymentStore } from '../../../payment-service/src/infrastructure/memory/in-memory-payment-store.js';
import type { RiskAssessment } from '../../src/application/risk-assessment.js';
import { createSweepExpiredReservations } from '../../src/application/sweep-expired-reservations.js';
import type { SweepRound } from '../../src/application/sweep-expired-reservations.js';
import { buildOrderService } from '../../src/bootstrap.js';
import type { ExpiredOrderFinder } from '../../src/domain/expired-order-finder.js';
import type { OrderHistoryReader } from '../../src/domain/order-history-reader.js';
import type { OrderOutbox } from '../../src/domain/order-outbox.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import { DEPENDENCY, dependencyResilience } from '../../src/infrastructure/grpc-resilience.js';
import { GrpcStockReservations } from '../../src/infrastructure/inventory/grpc-stock-reservations.js';
import { GrpcPayments } from '../../src/infrastructure/payment/grpc-payments.js';
import { FakeCatalogPricing } from './fake-catalog-pricing.js';
import { FUNCTIONAL_TIMEOUT_MS } from './held-replies.js';
import { orderCalls } from './qa-order-calls.js';
import type { OrderCalls } from './qa-order-calls.js';
import type { PaymentFaults } from './qa-payment-faults.js';

const SWEEP_BATCH = 50;

/** Kapatma adimlari; cagiran ters sirayla kapatir (closeAll). */
export type Closers = (() => unknown)[];

/** payment'in gRPC'sini acar; adresi doner. */
export async function startPayment(parts: {
  readonly payments: InMemoryPaymentStore;
  readonly faults: PaymentFaults;
  readonly clock: Clock;
  readonly closers: Closers;
}): Promise<string> {
  const server = await startTestGrpcServer({
    serviceName: 'qa-payment',
    logger: silentLogger,
    services: [
      parts.faults.wrap(buildPaymentService({ repository: parts.payments, clock: parts.clock })),
    ],
  });
  parts.closers.push(() => server.stop());
  return `127.0.0.1:${server.handle.port}`;
}

export interface OrderCopyParts {
  readonly name: string;
  readonly clock: Clock;
  readonly store: {
    readonly repository: OrderRepository;
    readonly history: OrderHistoryReader;
    readonly outbox: OrderOutbox;
    readonly expired: ExpiredOrderFinder;
  };
  readonly risk: RiskAssessment;
  readonly paymentAddress: string;
  readonly inventoryAddress: string;
  /** order -> payment siniri; varsayilan islevsel 2 sn (#113). */
  readonly paymentTimeoutMs?: number | undefined;
  readonly closers: Closers;
}

export interface StartedOrderCopy {
  /** Bu kopyanin gRPC'sine order cagrilari. */
  readonly calls: OrderCalls;
  /** Supurucu bir tur. */
  sweep(): Promise<SweepRound>;
}

export async function startOrderCopy(parts: OrderCopyParts): Promise<StartedOrderCopy> {
  const { store, clock, closers } = parts;
  const payments = new GrpcPayments(
    parts.paymentAddress,
    parts.paymentTimeoutMs ?? FUNCTIONAL_TIMEOUT_MS,
    dependencyResilience(DEPENDENCY.PAYMENT, silentLogger),
  );
  closers.push(() => payments.close());
  const stock = new GrpcStockReservations(
    parts.inventoryAddress,
    FUNCTIONAL_TIMEOUT_MS,
    dependencyResilience(DEPENDENCY.INVENTORY, silentLogger),
  );
  closers.push(() => stock.close());
  const server = await startTestGrpcServer({
    serviceName: parts.name,
    logger: silentLogger,
    services: [
      buildOrderService({
        catalog: new FakeCatalogPricing(),
        risk: parts.risk,
        payments,
        stock,
        clock,
        store: { repository: store.repository, history: store.history, outbox: store.outbox },
      }),
    ],
  });
  closers.push(() => server.stop());
  const sweep = createSweepExpiredReservations({
    expired: store.expired,
    repository: store.repository,
    payments,
    stock,
    outbox: store.outbox,
    clock,
    batchSize: SWEEP_BATCH,
  });
  return { calls: orderCalls(server), sweep: () => sweep(silentLogger) };
}

/** payment'in dinledigi konular ve isleyicileri (iade, iptal), uretimdeki kayitla. */
export function paymentHandlers(
  payments: InMemoryPaymentStore,
  clock: Clock,
): ReadonlyMap<string, EventHandler> {
  const handlers = new Map<string, EventHandler>();
  subscribePaymentEvents(
    { subscribe: (topic, _group, handler) => handlers.set(topic, handler) },
    { repository: payments, clock },
  );
  return handlers;
}

/** Zarflari sirayla konusunun isleyicisine verir; payment'in dinlemedigi konu atlanir. */
export async function deliverTo(
  handlers: ReadonlyMap<string, EventHandler>,
  envelopes: readonly EventEnvelope[],
): Promise<{ readonly topic: string; readonly outcome: EventOutcome }[]> {
  const outcomes: { topic: string; outcome: EventOutcome }[] = [];
  for (const envelope of envelopes) {
    const handler = handlers.get(envelope.topic);
    if (handler === undefined) continue;
    outcomes.push({
      topic: envelope.topic,
      outcome: await handler(envelope, { attempt: 1, logger: silentLogger }),
    });
  }
  return outcomes;
}

/** Hepsini kapatir; biri dusse de digerleri kapanir, ilk hata sonda firlar. */
export async function closeAll(steps: readonly (() => unknown)[]): Promise<void> {
  let first: unknown;
  for (const step of steps) {
    try {
      await step();
    } catch (error: unknown) {
      first ??= error;
    }
  }
  if (first !== undefined) {
    throw first instanceof Error ? first : new Error('kapanis basarisiz', { cause: first });
  }
}
