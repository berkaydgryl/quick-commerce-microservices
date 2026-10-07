/**
 * QA (T15.2, payment geriye donuk PQ1-PQ3): payment kumesi. Iki kopya TEK Mongo'da (Testcontainers
 * mongo:7), uretimin acilisiyla (openPaymentStore: gocler, indeksler, kart kasasi), gercek gRPC
 * (PaymentService ve CardVaultService ayni sunucuda, main.ts gibi). Kopyalar AYNI sahte saati ve
 * AYNI saglayici casusunu paylasir:
 *
 *   - ProviderSpy mock saglayiciyi sarar: authorize ve verifyChallenge sayilir; istenirse kapida
 *     bekletilir (yarisi uykusuz hizalamak icin) ve authorize KARARINDAN SONRA, yazimdan once bir
 *     kanca calisir (PQ3: banka onayladi, kayit henuz yazilmadi).
 *   - Olay komutlari (refund_requested, cancel_requested) uretimin kaydiyla (subscribePaymentEvents)
 *     isleyiciye dogrudan teslim edilir; akis katmani (Redis, yeniden teslim) PR 2'de (PQ4).
 *   - Kopya acilirken depo sarmalanabilir (PQ3: kaybolan yazim).
 */

import { fixedClock } from '@getir/core';
import type { EventName, MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import type { EventEnvelope, EventHandler, EventOutcome } from '@getir/event-bus';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoEnv } from '@getir/mongo-kit';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { CallResult, TestGrpcServer } from '@getir/service-kit/testing';
import type { MethodDefinition } from '@grpc/grpc-js';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll } from 'vitest';

import {
  buildCardVaultService,
  buildPaymentService,
  subscribePaymentEvents,
} from '../../src/bootstrap.js';
import type {
  CardVerification,
  CardVerifier,
  VerifyCardInput,
} from '../../src/domain/card-verifier.js';
import type {
  AuthorizeInput,
  PaymentProvider,
  ProviderDecision,
  VerifyChallengeInput,
} from '../../src/domain/payment-provider.js';
import type { PaymentRepository } from '../../src/domain/payment-repository.js';
import { MockPaymentProvider } from '../../src/infrastructure/mock-provider/mock-payment-provider.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { PaymentDocument } from '../../src/infrastructure/mongo/documents.js';
import { openPaymentStore } from '../../src/infrastructure/payment-store.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const CONTAINER_START_TIMEOUT_MS = 120_000;
/** Uretimdeki gibi sureli (#51); PQ3'te donmus Mongo bu surede duser. */
const OPERATION_TIMEOUT_MS = 2_000;
const SERVER_SELECTION_TIMEOUT_MS = 5_000;
/** Saat ortak ve sabit: 3DS penceresi (60 sn) yalnizca advance ile gecer. */
const CLUSTER_START = Date.parse('2026-10-07T09:00:00Z');

/** Elle acilan kapi. */
export interface Gate {
  open(): void;
  readonly opened: Promise<void>;
}

export function gate(): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/**
 * Ilk `count` cagri `release`'e kadar bekler; `count` gelince `arrived` acilir. Fazlasi BEKLEMEZ:
 * yaris gerilerse (ikinci cagri saglayiciya ulasirsa) test asili kalmaz, sayac denetimi duser.
 */
export interface Hold {
  readonly arrived: Promise<void>;
  release(): void;
}

class Barrier implements Hold {
  private seen = 0;
  private readonly full = gate();
  private readonly released = gate();

  constructor(private readonly count: number) {}

  get arrived(): Promise<void> {
    return this.full.opened;
  }

  release(): void {
    this.released.open();
  }

  async pass(): Promise<void> {
    this.seen += 1;
    if (this.seen > this.count) return;
    if (this.seen === this.count) this.full.open();
    await this.released.opened;
  }
}

/** Mock saglayici + sayac + kapi. Kopyalar ayni casusu paylasir: sayac kumenin toplamidir. */
export class ProviderSpy implements PaymentProvider, CardVerifier {
  authorized = 0;
  /** Authorize kararindan SONRA, kayda yazmadan once (PQ3). */
  afterAuthorize: ((decision: ProviderDecision) => Promise<void> | void) | undefined;
  private readonly mock = new MockPaymentProvider();
  private authorizeHold: Barrier | undefined;
  private verifyHold: Barrier | undefined;

  /** Siradaki authorize cagrilari `release`'e kadar bekler; `count` gelince `arrived`. */
  holdAuthorize(count = 1): Hold {
    const barrier = new Barrier(count);
    this.authorizeHold = barrier;
    return barrier;
  }

  holdVerify(count = 1): Hold {
    const barrier = new Barrier(count);
    this.verifyHold = barrier;
    return barrier;
  }

  async authorize(input: AuthorizeInput): Promise<ProviderDecision> {
    this.authorized += 1;
    await this.authorizeHold?.pass();
    const decision = await this.mock.authorize(input);
    await this.afterAuthorize?.(decision);
    return decision;
  }

  /** Kapanista: test erken duserse bekleyen cagrilar sunucuyu kilitlemesin. */
  releaseAll(): void {
    this.authorizeHold?.release();
    this.verifyHold?.release();
  }

  async verifyChallenge(input: VerifyChallengeInput): Promise<boolean> {
    await this.verifyHold?.pass();
    return this.mock.verifyChallenge(input);
  }

  verifyCard(input: VerifyCardInput): Promise<CardVerification> {
    return this.mock.verifyCard(input);
  }
}

export interface MongoTarget {
  readonly uri: string;
  /** Konteynerin disa acilan adresi: PQ3'te dondurulabilen vekil buraya baglanir. */
  readonly host: string;
  readonly port: number;
}

/** Testcontainers Mongo (dosya basina bir kez). YALNIZCA bu konteyner; compose yigini disarida. */
export function useMongo(): () => MongoTarget {
  let container: StartedMongoDBContainer | undefined;
  beforeAll(async () => {
    container = await new MongoDBContainer(MONGO_IMAGE).start();
  }, CONTAINER_START_TIMEOUT_MS);
  afterAll(async () => {
    await container?.stop();
  });
  return () => {
    if (container === undefined) throw new Error('Mongo konteyneri henuz acilmadi');
    return {
      uri: directUri(container.getConnectionString()),
      host: container.getHost(),
      port: container.getFirstMappedPort(),
    };
  };
}

/** Tek dugume dogrudan baglanti (kume kesfi konteynerin ic adresine gitmesin). */
export function directUri(connectionString: string): string {
  return `${connectionString}${connectionString.includes('?') ? '&' : '?'}directConnection=true`;
}

let databases = 0;

/** Her kumeye taze veritabani: testler birbirinin kaydini gormez. */
export function mongoEnv(uri: string, dbName = `qa_payment_${(databases += 1)}`): MongoEnv {
  return {
    uri,
    dbName,
    serverSelectionTimeoutMs: SERVER_SELECTION_TIMEOUT_MS,
    operationTimeoutMs: OPERATION_TIMEOUT_MS,
  };
}

export interface PaymentCopy {
  call<TRequest, TResponse>(
    method: MethodDefinition<TRequest, TResponse>,
    request: TRequest,
  ): Promise<CallResult<TResponse>>;
  /** Komutu uretimin isleyicisine teslim eder; isleyici firlatirsa (yeniden teslim) o hata doner. */
  deliver(envelope: EventEnvelope, attempt?: number): Promise<EventOutcome>;
  stop(): Promise<void>;
}

export interface ClusterOptions {
  /** Kopya basina Mongo adresi (ayni veritabani; PQ3'te biri donan vekilden gecer). */
  readonly copies: readonly MongoEnv[];
  /** Belgeleri okuyan denetim baglantisi: vekilden GECMEZ. */
  readonly inspect: MongoEnv;
  /** Kopyanin deposunu sarar (PQ3 kaybolan yazim); verilmezse uretimdeki depo. */
  readonly wrap?: (repository: PaymentRepository, copy: number) => PaymentRepository;
}

export interface PaymentCluster {
  readonly copies: readonly PaymentCopy[];
  readonly provider: ProviderSpy;
  readonly clock: MutableClock;
  /** Kopyalarin butun gunluk satirlari (jeton denetimi). */
  readonly lines: readonly LogLine[];
  copy(index: number): PaymentCopy;
  documents(): Promise<PaymentDocument[]>;
  document(orderId: string): Promise<PaymentDocument | null>;
  /** Belge olmali (onkosul); yoksa test burada durur. */
  documentOf(orderId: string): Promise<PaymentDocument>;
  stop(): Promise<void>;
}

export async function startCluster(options: ClusterOptions): Promise<PaymentCluster> {
  const clock = fixedClock(CLUSTER_START);
  const provider = new ProviderSpy();
  const lines: LogLine[] = [];
  const inspector = await connectMongo({ ...options.inspect, appName: 'qa-payment-inspect' });
  const copies: PaymentCopy[] = [];
  try {
    for (const [index, env] of options.copies.entries()) {
      copies.push(await startCopy(index, env, { clock, provider, lines, wrap: options.wrap }));
    }
  } catch (error: unknown) {
    await Promise.allSettled([...copies.map((copy) => copy.stop()), inspector.close()]);
    throw error;
  }
  const payments = inspector.db.collection<PaymentDocument>(COLLECTIONS.PAYMENTS);
  return {
    copies,
    provider,
    clock,
    lines,
    copy: (index) => {
      const copy = copies[index % copies.length];
      if (copy === undefined) throw new Error('kumede kopya yok');
      return copy;
    },
    documents: () => payments.find({}).toArray(),
    document: (orderId) => payments.findOne({ orderId }),
    documentOf: async (orderId) => {
      const document = await payments.findOne({ orderId });
      if (document === null) throw new Error(`odeme belgesi yok: ${orderId}`);
      return document;
    },
    stop: async () => {
      provider.releaseAll();
      const results = await Promise.allSettled([
        ...copies.map((copy) => copy.stop()),
        inspector.close(),
      ]);
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed !== undefined) throw new Error('QA: kume kapanmadi', { cause: failed.reason });
    },
  };
}

interface Shared {
  readonly clock: MutableClock;
  readonly provider: ProviderSpy;
  readonly lines: LogLine[];
  readonly wrap: ClusterOptions['wrap'];
}

async function startCopy(index: number, env: MongoEnv, shared: Shared): Promise<PaymentCopy> {
  const logger = recordingLogger(shared.lines, { copy: index });
  const store = await openPaymentStore(env, logger);
  const repository = shared.wrap?.(store.repository, index) ?? store.repository;
  let server: TestGrpcServer;
  try {
    server = await startTestGrpcServer({
      serviceName: `qa-payment-${index}`,
      logger,
      services: [
        buildPaymentService({
          logger,
          repository,
          cards: store.cards,
          provider: shared.provider,
          clock: shared.clock,
        }),
        buildCardVaultService({
          logger,
          repository: store.cards,
          verifier: shared.provider,
          clock: shared.clock,
        }),
      ],
    });
  } catch (error: unknown) {
    await store.close();
    throw error;
  }
  const handlers = new Map<EventName, EventHandler>();
  subscribePaymentEvents(
    { subscribe: (topic, _group, handler) => handlers.set(topic, handler) },
    { repository, clock: shared.clock },
  );
  return {
    call: (method, request) => server.call(method, request),
    deliver: (envelope, attempt = 1) => {
      const handler = handlers.get(envelope.topic);
      if (handler === undefined) throw new Error(`payment bu konuyu dinlemiyor: ${envelope.topic}`);
      return handler(envelope, { attempt, logger });
    },
    stop: async () => {
      // main.ts sirasi: once cagrilar (sunucu), sonra veritabani.
      await server.stop('QA: kume kapandi');
      await store.close();
    },
  };
}
