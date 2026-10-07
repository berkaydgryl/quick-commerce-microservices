/**
 * QA (T15.2, order geriye donuk PR 1; OQ1-OQ3): IKI order kopyasi TEK Mongo'da (uretimin
 * openOrderStore'u: gocler, indeksler, outbox). Bagimlilar: GERCEK inventory (Redis + Mongo,
 * qa-payment-world useInventoryWorld; ayni Mongo konteyneri, ayri veritabani), GERCEK payment
 * (bellek, mock saglayici; iki kopya ayni payment'a bagli), sahte catalog ve risk (bant kullaniciya
 * gore). Ortak sahte saat. Kurulum tek kopyali dunyayla ortak (qa-order-copy.ts).
 *
 * Her kopyanin supurucusu ve outbox yayincisi testten TUR TUR cagrilir; yayincilar ortak AKISA
 * yazar (hangi kopya, hangi zarf) ve istenirse kapida bekletilir (OQ2: iki yayinci ayni bekleyenleri
 * okur). payment komutlari (iade, iptal) akistan payment'in kendi isleyicilerine verilir. payment'in
 * gRPC'si qa-payment-faults.ts ile sarilidir (OQ3: iki onayi payment'ta bulusturan bariyer).
 *
 * Her test kendi veritabanini acar (qa_orders_<n>); konteyner dosya sonunda silinir.
 */

import { RISK_BANDS, silentLogger } from '@getir/core';
import type { RiskBand } from '@getir/core';
import type { EventEnvelope, EventOutcome } from '@getir/event-bus';
import { expect } from 'vitest';

import { InMemoryPaymentStore } from '../../../payment-service/src/infrastructure/memory/in-memory-payment-store.js';
import { createRelayOutbox } from '../../src/application/relay-outbox.js';
import type {
  RiskAssessment,
  RiskAssessmentResult,
} from '../../src/application/risk-assessment.js';
import type { SweepRound } from '../../src/application/sweep-expired-reservations.js';
import type { OrderRiskContext } from '../../src/domain/checkout-risk.js';
import type { ExpiredOrderFinder } from '../../src/domain/expired-order-finder.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';
import type { OrderStore } from '../../src/infrastructure/order-store.js';
import { TEST_CARD } from './fake-payments.js';
import type { Gate } from './qa-grpc-faults.js';
import { nextUser } from './qa-order-calls.js';
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

const RELAY_BATCH = 500;
const COPIES = 2;
const SCORES: Readonly<Record<RiskBand, number>> = {
  [RISK_BANDS.LOW]: 10,
  [RISK_BANDS.MEDIUM]: 40,
  [RISK_BANDS.HIGH]: 80,
  [RISK_BANDS.CRITICAL]: 95,
};

/** Risk bandi kullaniciya gore (OQ1 karisik bantlar); verilmeyen kullanici LOW. Puan bilgi amacli. */
export class BandByUser implements RiskAssessment {
  readonly bands = new Map<string, RiskBand>();

  evaluate(context: OrderRiskContext): Promise<RiskAssessmentResult> {
    const band = this.bands.get(context.userId) ?? RISK_BANDS.LOW;
    return Promise.resolve({ band, score: SCORES[band] });
  }
}

/** Akistaki bir zarf: hangi kopyanin yayincisi yazdi. */
export interface Published {
  readonly copy: number;
  readonly envelope: EventEnvelope;
}

export interface OrderCopy {
  readonly store: OrderStore;
  /** Bu kopyanin gRPC'sine order cagrilari. */
  readonly calls: OrderCalls;
  /** Supurucu bir tur. */
  sweep(): Promise<SweepRound>;
  /** Outbox yayincisi bir tur; `hold` verilirse okumadan SONRA, yayindan once kapida bekler. */
  relay(hold?: { readonly arrived: Gate; readonly release: Gate }): Promise<void>;
}

export interface OrderCluster {
  readonly risk: BandByUser;
  readonly payments: InMemoryPaymentStore;
  /** payment gRPC'sinin ariza katmani (kapilar, bariyer, cagri sayisi). */
  readonly faults: PaymentFaults;
  /** Ortak siparis deposu (iki kopya ayni Mongo'yu okur); denetim icin. */
  readonly orders: OrderRepository;
  /** Iki yayincinin ortak akisi (yayin sirasiyla). */
  readonly stream: Published[];
  /** Kopya 0 ya da 1; baska numara hatadir (iki kopya senaryosu sessizce teke inmesin). */
  copy(index: number): OrderCopy;
  /** Her cagri yeni kullanici (qa-order-calls.ts). */
  nextUser(): string;
  /** Akistaki payment komutlarini (iade, iptal) payment'in isleyicilerine verir; sonuclar. */
  deliverPaymentCommands(from: number): Promise<readonly EventOutcome[]>;
}

export interface ClusterOptions {
  /**
   * order -> payment cagrisinin siniri. Varsayilan islevsel 2 sn (#113). Kapida bekletilen
   * cagrinin ARKASINDAN baska istek kosan senaryo genis verir: sonuc saate degil kapiya bagli.
   */
  readonly paymentTimeoutMs?: number;
  /** Supurucunun is kuyrugunu sarar (OQ4: iki supurucu ayni partiyi okuyup bulusur). */
  readonly expired?: (finder: ExpiredOrderFinder) => ExpiredOrderFinder;
}

let databases = 0;

/** Kume HER TEST icin taze (ayri veritabani): `open()` testin icinde, test sonunda kapanir. */
export function useOrderClusters(
  world: InventoryWorld,
): (options?: ClusterOptions) => Promise<OrderCluster> {
  const open = useFreshPerTest((closers: Closers, options: ClusterOptions) =>
    startOrderCluster(world, options, closers),
  );
  return (options = {}) => open(options);
}

async function startOrderCluster(
  world: InventoryWorld,
  options: ClusterOptions,
  closers: Closers,
): Promise<OrderCluster> {
  databases += 1;
  const env = testMongoEnv(world.mongoUri(), `qa_orders_${String(databases)}`);
  const stream: Published[] = [];
  const risk = new BandByUser();
  const payments = new InMemoryPaymentStore();
  const faults = new PaymentFaults();
  const paymentAddress = await startPayment({ payments, faults, clock: world.clock, closers });
  const handlers = paymentHandlers(payments, world.clock);
  const copies: OrderCopy[] = [];
  for (let index = 0; index < COPIES; index += 1) {
    const store = await openOrderStore(env, silentLogger, 'development');
    closers.push(() => store.close());
    const started = await startOrderCopy({
      name: `qa-order-${String(index)}`,
      clock: world.clock,
      store: { ...store, expired: options.expired?.(store.expired) ?? store.expired },
      risk,
      paymentAddress,
      inventoryAddress: world.address(),
      paymentTimeoutMs: options.paymentTimeoutMs,
      closers,
    });
    copies.push({ store, ...started, relay: relayInto(index, store, world, stream) });
  }
  const copy = (index: number): OrderCopy => {
    const found = copies[index];
    if (found === undefined) throw new Error(`kumede kopya ${String(index)} yok`);
    return found;
  };
  return {
    risk,
    payments,
    faults,
    orders: copy(0).store.repository,
    stream,
    copy,
    nextUser,
    deliverPaymentCommands: async (from) => {
      const envelopes = stream.slice(from).map(({ envelope }) => envelope);
      return (await deliverTo(handlers, envelopes)).map(({ outcome }) => outcome);
    },
  };
}

/** Kopyanin yayincisi: ortak akisa yazar; `hold` ilk yayindan once kapida bekletir. */
function relayInto(
  index: number,
  store: OrderStore,
  world: InventoryWorld,
  stream: Published[],
): OrderCopy['relay'] {
  return async (hold) => {
    let first = true;
    const relay = createRelayOutbox({
      outbox: store.outbox,
      publisher: {
        publish: async (envelope) => {
          if (first && hold !== undefined) {
            first = false;
            hold.arrived.open();
            await hold.release.opened;
          }
          stream.push({ copy: index, envelope });
        },
      },
      clock: world.clock,
      batchSize: RELAY_BATCH,
    });
    await relay(silentLogger);
  };
}

/** 3DS bekleyen siparis: taslak kopya 0'da, 3DS isteyen kartla siparis kopya 1'de. */
export async function openChallenge(
  cluster: OrderCluster,
): Promise<{ readonly orderId: string; readonly userId: string; readonly challengeId: string }> {
  const userId = cluster.nextUser();
  const orderId = await cluster.copy(0).calls.draft(userId);
  const created = await cluster.copy(1).calls.createOrder(orderId, userId, TEST_CARD.CHALLENGE);
  expect(created.error).toBeUndefined();
  const challengeId = created.response?.challengeId ?? '';
  expect(challengeId).not.toBe('');
  return { orderId, userId, challengeId };
}
