/**
 * QA kara kutu (T15.2 geriye donuk tur, inventory PR 1; IQ3): KAYBOLAN CEVAP. order'in GERCEK
 * stok istemcisi (GrpcStockReservations, uretimdeki dependencyResilience ve 1 sn sure), GERCEK
 * inventory (openStockSource: Redis + Mongo, sabit saat).
 *
 * Kayip gRPC ISLEYICISINDE kurulur: gercek isleyici TAMAMEN calisir (Lua, Mongo, defter, iz
 * silme), sonra basarili cevap bir kez kaybolur (SERVICE_UNAVAILABLE) ya da sure dolana kadar
 * bekletilir. Tasima katmaninda tek cevabi dusurmek (HTTP/2) guvenilmez; isleyici kancasi belirleyici.
 *
 *   Reserve, Commit, Release, Shorten (IDEMPOTENT): ayni cagri icinde yeniden denenir; order basari
 *     gorur, stok ve defter TAM BIR kez. Commit/Release'in tekrari izi silinmis siparisi defterden
 *     tanir (ALREADY_APPLIED).
 *   Yavas cevap: tek sure siniri tukenir, cagri icinde tekrar yok; ayni orderId ile sonraki cagri
 *     ayni bitisi doner (stok bir kez).
 *   Yarida kalan onay (ADR-18): depo katmaninda Lua uygulanir, Mongo yazilmadan hata; tekrar onayi
 *     tamamlar.
 *   Extend (beklenen bitisle IDEMPOTENT, T15.3; bekleyen is 117): cevap kaybolursa order yeniden
 *     dener; tekrar guncel bitisi alir (moved), hak, bitis ve defter BIR kez.
 */

import { AppError, ERROR_CODES, fixedClock, silentLogger } from '@getir/core';
import { reservationKey, stockAvailKey } from '@getir/redis-kit';
import { toServiceError } from '@getir/service-kit';
import type { GrpcServiceRegistration } from '@getir/service-kit';
import { startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import type { sendUnaryData, ServerUnaryCall, UntypedServiceImplementation } from '@grpc/grpc-js';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSeedStock } from '../../../inventory-service/src/application/seed-stock.js';
import { buildInventoryService } from '../../../inventory-service/src/bootstrap.js';
import type { StockStoresEnv } from '../../../inventory-service/src/config/env.js';
import type { ReservationStore } from '../../../inventory-service/src/domain/reservation.js';
import type { StockLevel } from '../../../inventory-service/src/domain/stock.js';
import { LEDGER_KINDS } from '../../../inventory-service/src/domain/stock-ledger.js';
import type { LedgerKind } from '../../../inventory-service/src/domain/stock-ledger.js';
import { COLLECTIONS } from '../../../inventory-service/src/infrastructure/mongo/documents.js';
import type {
  StockDocument,
  StockLedgerDocument,
} from '../../../inventory-service/src/infrastructure/mongo/documents.js';
import { MongoStockSeedWriter } from '../../../inventory-service/src/infrastructure/mongo/mongo-stock-seed-writer.js';
import type { StockSource } from '../../../inventory-service/src/infrastructure/stock-source.js';
import { openStockSource } from '../../../inventory-service/src/infrastructure/stock-source.js';
import type { StockStores } from '../../../inventory-service/src/infrastructure/stock-stores.js';
import { openStockStores } from '../../../inventory-service/src/infrastructure/stock-stores.js';
import { SETTLEMENT } from '../../src/application/stock-reservations.js';
import { INVENTORY_CALL_TIMEOUT_MS } from '../../src/config/constants.js';
import { RELEASE_REASON } from '../../src/domain/stock-reservation.js';
import { DEPENDENCY, dependencyResilience } from '../../src/infrastructure/grpc-resilience.js';
import { GrpcStockReservations } from '../../src/infrastructure/inventory/grpc-stock-reservations.js';

const MONGO_IMAGE = 'mongo:7';
const REDIS_IMAGE = 'redis:7-alpine';
const DB_NAME = 'qa_inventory_kayip_cevap';
const MARKET = 'mkt_qa-kayip-cevap';
const SKU = 'QA-K';
const ON_HAND = 50;
const LEVELS: readonly StockLevel[] = [{ marketId: MARKET, sku: SKU, onHand: ON_HAND }];
const TTL_SECONDS = 600;
const EXTEND_SECONDS = 120;
const SHORTEN_TO_SECONDS = 30;
const MS_PER_SECOND = 1_000;
/** Yavas cevap: istemcinin tek sure siniri dolsun (cagri icinde tekrar firsati kalmaz). */
const SLOW_REPLY_MS = INVENTORY_CALL_TIMEOUT_MS + 500;
const T0 = Date.parse('2026-10-07T09:00:00.000Z');
const scope = { requestId: 'req_qa_kayip_cevap', logger: silentLogger };

type Rpc = 'reserve' | 'commit' | 'release' | 'extendReservation' | 'shortenReservation';
const RPCS: readonly Rpc[] = [
  'reserve',
  'commit',
  'release',
  'extendReservation',
  'shortenReservation',
];
type Loss = 'drop' | 'slow';

const zeroCounts = (): Record<Rpc, number> => ({
  reserve: 0,
  commit: 0,
  release: 0,
  extendReservation: 0,
  shortenReservation: 0,
});

/**
 * gRPC isleyicisini sarar: GERCEK isleyici tamamen calisir, sonra basarili cevap bir kez kaybolur
 * (SERVICE_UNAVAILABLE) ya da sure dolana kadar bekletilir.
 */
class LossyReplies {
  /** Isleyiciye gelen istekler (yeniden deneme bunu artirir). */
  readonly received = zeroCounts();
  /** Gercek isleyicinin bitirdigi istekler (cevap kaybolsa da). */
  readonly completed = zeroCounts();
  private armed: { rpc: Rpc; orderId: string; loss: Loss } | undefined;

  loseNext(rpc: Rpc, orderId: string, loss: Loss = 'drop'): void {
    this.armed = { rpc, orderId, loss };
  }

  wrap(registration: GrpcServiceRegistration): GrpcServiceRegistration {
    const implementation: UntypedServiceImplementation = { ...registration.implementation };
    for (const rpc of RPCS) {
      const original = registration.implementation[rpc] as (
        call: ServerUnaryCall<{ orderId?: string }, unknown>,
        callback: sendUnaryData<unknown>,
      ) => void;
      const lossy = (
        call: ServerUnaryCall<{ orderId?: string }, unknown>,
        callback: sendUnaryData<unknown>,
      ): void => {
        this.received[rpc] += 1;
        original(call, (error, value, trailer, flags) => {
          this.completed[rpc] += 1;
          const armed = this.armed;
          if (error === null && armed?.rpc === rpc && armed.orderId === call.request.orderId) {
            this.armed = undefined;
            if (armed.loss === 'slow') {
              setTimeout(() => callback(error, value, trailer, flags), SLOW_REPLY_MS);
            } else {
              callback(
                toServiceError(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'QA: cevap kayboldu')),
              );
            }
            return;
          }
          callback(error, value, trailer, flags);
        });
      };
      implementation[rpc] = lossy as UntypedServiceImplementation[string];
    }
    return { ...registration, implementation };
  }
}

/** Depo: onay Lua'si uygulanir, Mongo ve defter yazilmadan hata (ADR-18 yarida kalan islem). */
function halfDoneCommits(inner: ReservationStore, armed: Set<string>): ReservationStore {
  return {
    reserve: (command) => inner.reserve(command),
    release: (command) => inner.release(command),
    commit: async (command) => {
      const outcome = await inner.commit(command);
      if (armed.delete(command.orderId)) {
        throw new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'QA: Redis onayli, Mongo yazilmadi');
      }
      return outcome;
    },
    extend: (command) => inner.extend(command),
    shorten: (command) => inner.shorten(command),
    expire: (command) => inner.expire(command),
    listDue: (marketId, nowMs, limit) => inner.listDue(marketId, nowMs, limit),
    forgetSettled: (marketId, orderId) => inner.forgetSettled(marketId, orderId),
  };
}

let mongoContainer: StartedMongoDBContainer;
let redisContainer: StartedRedisContainer;
let stores: StockStores;
let source: StockSource;
let server: TestGrpcServer;
let stock: GrpcStockReservations;
const replies = new LossyReplies();
const halfDone = new Set<string>();
let orderCounter = 0;

function storesEnv(): StockStoresEnv {
  return {
    mongo: {
      uri: `${mongoContainer.getConnectionString()}?directConnection=true`,
      dbName: DB_NAME,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: 5_000,
    },
    redis: { REDIS_URL: redisContainer.getConnectionUrl(), REDIS_CONNECT_TIMEOUT_MS: 5_000 },
  };
}

beforeAll(async () => {
  [mongoContainer, redisContainer] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  stores = await openStockStores(storesEnv(), silentLogger, 'qa-kayip-cevap');
  await createSeedStock({
    writer: new MongoStockSeedWriter(stores.mongo, stores.repository, stores.ledger),
    levels: LEVELS,
    isProduction: false,
  })();
  source = await openStockSource(storesEnv(), silentLogger);
  const inventory = buildInventoryService({
    stock: { ...source, reservations: halfDoneCommits(source.reservations, halfDone) },
    clock: fixedClock(T0),
  });
  server = await startTestGrpcServer({
    serviceName: 'qa-inventory',
    logger: silentLogger,
    services: [replies.wrap(inventory)],
  });
  stock = new GrpcStockReservations(
    `127.0.0.1:${server.handle.port}`,
    INVENTORY_CALL_TIMEOUT_MS,
    dependencyResilience(DEPENDENCY.INVENTORY, silentLogger),
  );
}, 120_000);

afterAll(async () => {
  stock?.close();
  await server?.stop();
  await source?.close();
  await stores?.close();
  await Promise.all([mongoContainer?.stop(), redisContainer?.stop()]);
});

function nextOrder(): { orderId: string; userId: string } {
  orderCounter += 1;
  const hex = orderCounter.toString(16).padStart(32, '0');
  return { orderId: `ord_${hex}`, userId: `usr_${hex}` };
}

/** Sayac; anahtar yoksa test duser (eksik sayac 0 sanilmasin). */
async function counter(): Promise<number> {
  const raw = await stores.redis.redis.get(stockAvailKey(MARKET, SKU));
  if (raw === null) throw new Error('sayac anahtari yok');
  return Number(raw);
}

async function onHand(): Promise<number> {
  const document = await stores.mongo.db
    .collection<StockDocument>(COLLECTIONS.STOCK)
    .findOne({ marketId: MARKET, sku: SKU });
  return document?.onHand ?? Number.NaN;
}

async function ledgerCount(orderId: string, kind: LedgerKind): Promise<number> {
  return stores.mongo.db
    .collection<StockLedgerDocument>(COLLECTIONS.STOCK_LEDGER)
    .countDocuments({ marketId: MARKET, orderId, kind });
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (error instanceof AppError) return error;
  throw new Error('AppError bekleniyordu');
}

function reserveRequest(orderId: string, userId: string) {
  return {
    orderId,
    userId,
    marketId: MARKET,
    lines: [{ sku: SKU, quantity: 2 }],
    ttlSeconds: TTL_SECONDS,
  };
}

/** Iki adetlik taze rezervasyon (kayipsiz). */
async function reserved(): Promise<{ orderId: string; expiresAt: Date }> {
  const { orderId, userId } = nextOrder();
  const outcome = await stock.reserve(reserveRequest(orderId, userId), scope);
  if (outcome.kind !== 'reserved') throw new Error(`rezervasyon acilmadi: ${outcome.kind}`);
  return { orderId, expiresAt: outcome.expiresAt };
}

describe('QA IQ3 kaybolan cevap: IDEMPOTENT islemler cagri icinde tekrar edilir, stok bir kez', () => {
  it('Reserve: islendi, cevap kayboldu -> ayni cagri tekrar eder; "zaten rezerve", sayac BIR kez duser', async () => {
    const { orderId, userId } = nextOrder();
    const before = await counter();
    const received = replies.received.reserve;
    replies.loseNext('reserve', orderId);

    const outcome = await stock.reserve(reserveRequest(orderId, userId), scope);

    expect(replies.received.reserve - received, 'kayip + tekrar').toBe(2);
    expect(outcome).toEqual({
      kind: 'reserved',
      expiresAt: new Date(T0 + TTL_SECONDS * MS_PER_SECOND),
    });
    expect(await counter()).toBe(before - 2);
  });

  it('Commit: islendi (Mongo + defter), cevap kayboldu -> tekrar izi silinmis siparisi defterden tanir: ALREADY_APPLIED', async () => {
    const { orderId } = await reserved();
    const handBefore = await onHand();
    const received = replies.received.commit;
    replies.loseNext('commit', orderId);

    const settlement = await stock.commit({ orderId, marketId: MARKET }, scope);

    expect(replies.received.commit - received, 'kayip + tekrar').toBe(2);
    expect(settlement).toBe(SETTLEMENT.ALREADY_APPLIED);
    expect(await onHand()).toBe(handBefore - 2);
    expect(await ledgerCount(orderId, LEDGER_KINDS.COMMIT)).toBe(1);
  });

  it('Release: islendi, cevap kayboldu -> tekrar ALREADY_APPLIED; sayac BIR kez geri doner, defterde tek birakma', async () => {
    const { orderId } = await reserved();
    const held = await counter();
    const received = replies.received.release;
    replies.loseNext('release', orderId);

    const settlement = await stock.release(
      { orderId, marketId: MARKET, reason: RELEASE_REASON.CART_RELEASED },
      scope,
    );

    expect(replies.received.release - received, 'kayip + tekrar').toBe(2);
    expect(settlement).toBe(SETTLEMENT.ALREADY_APPLIED);
    expect(await counter()).toBe(held + 2);
    expect(await ledgerCount(orderId, LEDGER_KINDS.RELEASE)).toBe(1);
  });

  it('Shorten: islendi, cevap kayboldu -> tekrar; bitis tam sinira iner, rezervasyon aktif', async () => {
    const { orderId } = await reserved();
    const received = replies.received.shortenReservation;
    replies.loseNext('shortenReservation', orderId);

    const timing = await stock.shorten(
      { orderId, marketId: MARKET, maxRemainingSeconds: SHORTEN_TO_SECONDS },
      scope,
    );

    expect(replies.received.shortenReservation - received, 'kayip + tekrar').toBe(2);
    expect(timing).toMatchObject({
      kind: 'active',
      expiresAt: new Date(T0 + SHORTEN_TO_SECONDS * MS_PER_SECOND),
    });
  });
});

describe('QA IQ3 yavas cevap ve yarida kalan islem', () => {
  it('Reserve yavas: sure dolar, cagri icinde tekrar YOK; stok dustu; ayni orderId tekrar -> ayni bitis, sayac AYNI', async () => {
    const { orderId, userId } = nextOrder();
    const before = await counter();
    const received = replies.received.reserve;
    const completed = replies.completed.reserve;
    replies.loseNext('reserve', orderId, 'slow');

    const first = await rejection(stock.reserve(reserveRequest(orderId, userId), scope));
    const receivedAfterFirst = replies.received.reserve - received;
    // Yuklu makinede istek sunucuya sure siniri dolduktan SONRA da ulasabilir: islenmesini bekle.
    await vi.waitFor(() => expect(replies.completed.reserve - completed).toBe(1), {
      timeout: 5_000,
    });
    const afterFirst = await counter();
    const hash = await stores.redis.redis.hgetall(reservationKey(MARKET, orderId));
    const second = await stock.reserve(reserveRequest(orderId, userId), scope);

    expect(first.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(receivedAfterFirst, 'tek sure siniri: tekrar yok').toBe(1);
    expect(afterFirst, 'ilk cagri islendi').toBe(before - 2);
    expect(second).toEqual({ kind: 'reserved', expiresAt: new Date(Number(hash['expiresAt'])) });
    expect(await counter(), 'ikinci cagri stogu TEKRAR dusurmez').toBe(before - 2);
  });

  it('Commit yarida (ADR-18): Lua uygulandi, Mongo yazilmadan hata -> tekrar onayi tamamlar; onHand BIR kez', async () => {
    const { orderId } = await reserved();
    const handBefore = await onHand();
    const received = replies.received.commit;
    halfDone.add(orderId);

    const settlement = await stock.commit({ orderId, marketId: MARKET }, scope);

    expect(halfDone.has(orderId), 'yarida kalma gerceklesti').toBe(false);
    expect(replies.received.commit - received, 'hata + tekrar').toBe(2);
    expect([SETTLEMENT.APPLIED, SETTLEMENT.ALREADY_APPLIED]).toContain(settlement);
    expect(await onHand()).toBe(handBefore - 2);
    expect(await ledgerCount(orderId, LEDGER_KINDS.COMMIT)).toBe(1);
  });
});

// Bekleyen is 117 (T15.3): Extend beklenen bitisle gider ve yeniden denenir. Duzeltmeden once bu
// test "order hata gorur, hak tukenir" davranisini belgeliyordu; artik tersine dondu.
describe('QA IQ3 Extend (beklenen bitisle IDEMPOTENT, T15.3): cevap kaybolursa', () => {
  it('order yeniden dener; tekrar guncel bitisi alir (moved); hak, bitis ve defter BIR kez', async () => {
    const { orderId, expiresAt } = await reserved();
    const received = replies.received.extendReservation;
    replies.loseNext('extendReservation', orderId);

    const timing = await stock.extend(
      {
        orderId,
        marketId: MARKET,
        additionalSeconds: EXTEND_SECONDS,
        expectedExpiresAt: expiresAt,
      },
      scope,
    );
    const hash = await stores.redis.redis.hgetall(reservationKey(MARKET, orderId));
    const extendedTo = expiresAt.getTime() + EXTEND_SECONDS * MS_PER_SECOND;

    expect(timing).toEqual({ kind: 'moved', expiresAt: new Date(extendedTo) });
    expect(replies.received.extendReservation - received, 'IDEMPOTENT: kayip + tekrar').toBe(2);
    expect(Number(hash['extended']), 'hak bir kez').toBe(1);
    expect(Number(hash['expiresAt']), 'bitis bir kez ileri').toBe(extendedTo);
    expect(await ledgerCount(orderId, LEDGER_KINDS.EXTEND), 'defterde tek uzatma').toBe(1);
  });
});
