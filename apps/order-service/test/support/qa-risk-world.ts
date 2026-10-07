/**
 * QA (T15.2, risk geriye donuk PR 1; RQ0): order + GERCEK risk + gercek payment ve inventory. risk
 * uretimin buildRiskService'i ile acilir: gercek kurallar ve agirliklar (risk.rules.json), her
 * degerlendirme risk_events deposuna (bellek) yazilir ve testte okunur. order tek kopya, kendi Mongo
 * veritabaninda: risk gecmisi (teslim ve iptal sayilari) uretimin sorgusuyla. Ucu ve risk ayni
 * sahte saati paylasir: dwell (rezervasyondan siparise) ve hesap yasi saatle kurulur.
 *
 * Gateway'in sinyalleri GERCEKCI ve temizdir (cleanSignals): ayni cihaz, cihazda tek hesap, oturum
 * konumu teslimat konumunda. Boylece yalniz olculen kurallar (hesap yasi, dwell, siparis gecmisi)
 * oynar; baska bir sinyalin donguyu durdurdugu ayrica olculur (geofence).
 */

import { ORDER_STATUS, silentLogger } from '@getir/core';
import type { EventEnvelope } from '@getir/event-bus';
import type { orderV1 } from '@getir/proto';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { CallResult } from '@getir/service-kit/testing';

import { InMemoryPaymentStore } from '../../../payment-service/src/infrastructure/memory/in-memory-payment-store.js';
import { buildRiskService } from '../../../risk-service/src/bootstrap.js';
import type { RiskEvent } from '../../../risk-service/src/domain/risk-event.js';
import { InMemoryRiskEventStore } from '../../../risk-service/src/infrastructure/memory/in-memory-risk-event-store.js';
import { createRelayOutbox } from '../../src/application/relay-outbox.js';
import { orderCreatedEvents } from '../../src/domain/order-events.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import { createDraftOrder } from '../../src/domain/order.js';
import { DEPENDENCY, dependencyResilience } from '../../src/infrastructure/grpc-resilience.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';
import { GrpcRiskAssessment } from '../../src/infrastructure/risk/grpc-risk-assessment.js';
import { TEST_CARD } from './fake-payments.js';
import { FUNCTIONAL_TIMEOUT_MS } from './held-replies.js';
import { sampleDraftInput } from './order-builders.js';
import { draftRequest } from './order-fixtures.js';
import type { OrderCalls } from './qa-order-calls.js';
import {
  deliverTo,
  paymentHandlers,
  startOrderCopy,
  startPayment,
  testMongoEnv,
  useFreshPerTest,
} from './qa-order-copy.js';
import type { Closers } from './qa-order-copy.js';
import { PaymentFaults } from './qa-payment-faults.js';
import type { InventoryWorld } from './qa-payment-world.js';

/** Taslagin teslimat konumu (order-fixtures.ts draftRequest). */
const DELIVERY = draftRequest.deliveryLocation ?? { lat: 0, lng: 0 };

/**
 * Temiz sinyaller: ayni cihaz ve IP, cihazda tek hesap, oturum konumu teslimat konumunda. Yalniz
 * hesabin acilis ani ve (istenirse) oturum konumu degisir.
 */
export function cleanSignals(
  accountCreatedAt: Date,
  sessionLocation: { readonly lat: number; readonly lng: number } = DELIVERY,
): orderV1.CheckoutSignals {
  return {
    ipAddress: '203.0.113.10',
    ipCity: 'Istanbul',
    deviceId: 'dev_qa_tek_cihaz',
    accountsOnDevice: 1,
    previousIpAddress: '203.0.113.10',
    sessionLocation,
    accountCreatedAt,
  };
}

export interface RiskShop {
  readonly calls: OrderCalls;
  readonly payments: InMemoryPaymentStore;
  readonly orders: OrderRepository;
  /** Onayli kartla siparis (3DS yalnizca bant isterse), gateway'in sinyalleriyle. */
  order(
    orderId: string,
    userId: string,
    signals: orderV1.CheckoutSignals,
  ): Promise<CallResult<orderV1.CreateOrderResponse>>;
  /** Kullanicinin teslim edilmis gecmis siparisleri (risk gecmisi; tutar taslakla ayni). */
  delivered(userId: string, count: number): Promise<void>;
  /** risk'in bu siparis icin son degerlendirmesi (puan, bant, tetiklenen kurallar). */
  evaluation(userId: string, orderId: string): Promise<RiskEvent | null>;
  /** Outbox'i yayinlar ve payment komutlarini (iptal, iade) payment'in isleyicilerine verir. */
  deliverPaymentCommands(): Promise<void>;
  /** Supuruculer bir tur: once inventory (kilidi dolani birakir), sonra order (siparisi kapatir). */
  sweep(): Promise<void>;
}

let databases = 0;

/** Dukkan HER TEST icin taze (ayri veritabani): `open()` testin icinde, test sonunda kapanir. */
export function useRiskShops(world: InventoryWorld): () => Promise<RiskShop> {
  const open = useFreshPerTest((closers: Closers, _options: undefined) =>
    openRiskShop(world, closers),
  );
  return () => open(undefined);
}

async function openRiskShop(world: InventoryWorld, closers: Closers): Promise<RiskShop> {
  databases += 1;
  const events = new InMemoryRiskEventStore();
  const riskServer = await startTestGrpcServer({
    serviceName: 'qa-risk',
    logger: silentLogger,
    services: [buildRiskService({ events, clock: world.clock })],
  });
  closers.push(() => riskServer.stop());
  const risk = new GrpcRiskAssessment(
    `127.0.0.1:${String(riskServer.handle.port)}`,
    FUNCTIONAL_TIMEOUT_MS,
    dependencyResilience(DEPENDENCY.RISK, silentLogger),
  );
  closers.push(() => risk.close());
  const payments = new InMemoryPaymentStore();
  const paymentAddress = await startPayment({
    payments,
    faults: new PaymentFaults(),
    clock: world.clock,
    closers,
  });
  const store = await openOrderStore(
    testMongoEnv(world.mongoUri(), `qa_risk_dongu_${String(databases)}`),
    silentLogger,
    'development',
  );
  closers.push(() => store.close());
  const copy = await startOrderCopy({
    name: 'qa-order-risk',
    clock: world.clock,
    store,
    risk,
    paymentAddress,
    inventoryAddress: world.address(),
    closers,
  });
  const handlers = paymentHandlers(payments, world.clock);
  return {
    calls: copy.calls,
    payments,
    orders: store.repository,
    order: (orderId, userId, signals) =>
      copy.calls.createOrder(orderId, userId, TEST_CARD.APPROVED, { signals }),
    delivered: async (userId, count) => {
      for (let index = 0; index < count; index += 1) {
        const draft = createDraftOrder(sampleDraftInput({ userId }), world.clock);
        // Risk gecmisi durum ve tutara bakar; gecmisin yolu (kurye, teslim) burada kurulmaz.
        const delivered = {
          ...draft,
          status: ORDER_STATUS.DELIVERED,
          timeline: [...draft.timeline, { status: ORDER_STATUS.DELIVERED, at: world.clock.date() }],
        };
        await store.repository.insert(delivered, orderCreatedEvents(delivered));
      }
    },
    evaluation: (userId, orderId) => events.findLatest({ userId, orderId }),
    deliverPaymentCommands: async () => {
      const published: EventEnvelope[] = [];
      await createRelayOutbox({
        outbox: store.outbox,
        publisher: {
          publish: (envelope) => {
            published.push(envelope);
            return Promise.resolve();
          },
        },
        clock: world.clock,
        batchSize: 500,
      })(silentLogger);
      await deliverTo(handlers, published);
    },
    sweep: async () => {
      await world.sweepInventory();
      await copy.sweep();
    },
  };
}
