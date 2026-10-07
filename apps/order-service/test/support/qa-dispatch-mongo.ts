/**
 * QA destek (T13.1 PR 2; D18 bolmesi): qa-courier-dispatch ve
 * qa-courier-dispatch-failures dosyalarinin ORTAK Mongo dunyasi. Gercek Mongo
 * (Testcontainers), courier ve order kendi veritabaninda (D14); courier-svc
 * gercek gRPC sunucusuyla, order servisin acilis yoluyla (openOrderStore).
 * Yardimcilar qa-courier-dispatch.spec.ts'ten AYNEN tasindi.
 */

import { ORDER_STATUS, silentLogger } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import { afterAll, afterEach, beforeAll } from 'vitest';

import type { Courier } from '../../../courier-service/src/domain/courier.js';
import { CourierMongoStore } from '../../../courier-service/src/infrastructure/mongo/courier-mongo-store.js';
import { MARKET_LOCATION_SEEDS } from '../../../courier-service/src/infrastructure/fixtures/couriers.js';
import { CouriersCollection } from '../../../courier-service/src/infrastructure/mongo/couriers-collection.js';
import { MarketsCollection } from '../../../courier-service/src/infrastructure/mongo/markets-collection.js';
import { MongoCourierSeedWriter } from '../../../courier-service/src/infrastructure/mongo/mongo-courier-seed-writer.js';
import { statusChangedEvents } from '../../src/domain/order-events.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';
import type { OrderStore } from '../../src/infrastructure/order-store.js';
import {
  HookedCourierRepository,
  isBusy,
  orderSide,
  startCourierService,
} from './qa-courier-world.js';
import type { QaCourierService, QaOrderSide, FREE_FIXED_PORT } from './qa-courier-world.js';

const MONGO_IMAGE = 'mongo:7';
const MONGO_PORT = 27_017;
/**
 * Sureli baglanti (#51 surucu yollari) ama yuklu makinede yanlis kirmizi vermesin
 * diye genis; donma testinde kisa (FROZEN_TIMEOUT_MS).
 */
const STORE_TIMEOUT_MS = 10_000;
export const FROZEN_TIMEOUT_MS = 500;

let container: StartedMongoDBContainer;
/** Servislerin disindan okuma (outbox, profiler). */
let raw: MongoClient;
let dbCounter = 0;
const cleanups: (() => Promise<void> | void)[] = [];
/** useDispatchMongo bu dosyada cagrildi mi (iki kez cagri ikinci konteyneri sizdirirdi). */
let registered = false;

function directUri(): string {
  return `${started().getConnectionString()}/?directConnection=true`;
}

/** Calisan konteyner; useDispatchMongo cagrilmadan kullanilirsa acik hata. */
function started(): StartedMongoDBContainer {
  if (!registered) {
    throw new Error('qa-dispatch-mongo: once dosyanin en ustunde useDispatchMongo() cagrilmali');
  }
  return container;
}

/**
 * Dosyanin Mongo kabi ve temizligi: her spec dosyasi bir kez, en ustte cagirir
 * (kendi konteyneri; her testten sonra cleanups tersten bosaltilir).
 */
export function useDispatchMongo(): void {
  if (registered) {
    throw new Error('qa-dispatch-mongo: useDispatchMongo() dosya basina BIR kez cagrilir');
  }
  registered = true;
  beforeAll(async () => {
    container = await new MongoDBContainer(MONGO_IMAGE).start();
    raw = await MongoClient.connect(directUri());
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  afterAll(async () => {
    await raw?.close();
    await container?.stop();
  });
}

/** Spec dosyalarinin `raw` istemcisine erisimi (beforeAll'da kurulur). */
export function rawMongo(): MongoClient {
  started();
  return raw;
}

/** Mongo'nun disaridan adresi (donma vekilinin hedefi). */
export function mongoHostPort(): { readonly host: string; readonly port: number } {
  const mongo = started();
  return { host: mongo.getHost(), port: mongo.getMappedPort(MONGO_PORT) };
}

/** Testin kendi kaynagi: test bitince (afterEach) tersten kapatilir. */
export function onCleanup(cleanup: () => Promise<void> | void): void {
  cleanups.push(cleanup);
}

/** Her test kendi iki veritabaninda (D14: servis basina veritabani). */
export function freshDbs(): { readonly order: string; readonly courier: string } {
  dbCounter += 1;
  return { order: `qa_order_${dbCounter}`, courier: `qa_courier_${dbCounter}` };
}

interface CourierSide {
  readonly service: QaCourierService;
  readonly hooks: HookedCourierRepository;
  readonly connection: MongoConnection;
}

/** courier-svc: kendi Mongo veritabani, kuryeler seed yazicisiyla, gercek gRPC sunucusu. */
export async function courierOnMongo(options: {
  readonly dbName: string;
  readonly placed?: readonly Courier[];
  readonly clock: MutableClock;
  readonly lines?: LogLine[];
  readonly port?: number | typeof FREE_FIXED_PORT;
}): Promise<CourierSide> {
  const connection = await connectMongo({
    uri: directUri(),
    dbName: options.dbName,
    operationTimeoutMs: STORE_TIMEOUT_MS,
  });
  cleanups.push(() => connection.close());
  const collection = new CouriersCollection(connection.db);
  const markets = new MarketsCollection(connection.db);
  await collection.ensureIndexes();
  if (options.placed !== undefined) {
    await new MongoCourierSeedWriter(connection, collection, markets).replaceAll(
      options.placed,
      MARKET_LOCATION_SEEDS,
    );
  }
  const hooks = new HookedCourierRepository(new CourierMongoStore(collection, markets));
  const service = await startCourierService({
    repository: hooks,
    clock: options.clock,
    ...(options.lines === undefined ? {} : { logger: recordingLogger(options.lines) }),
    ...(options.port === undefined ? {} : { port: options.port }),
  });
  cleanups.push(() => service.stop());
  return { service, hooks, connection };
}

/** order: servisin acilis yoluyla (openOrderStore: gocler + indeksler) kendi veritabaninda. */
export async function orderOnMongo(options: {
  readonly dbName: string;
  readonly courierAddress: string;
  readonly clock: MutableClock;
  readonly lines?: LogLine[];
  readonly uri?: string;
  readonly operationTimeoutMs?: number;
}): Promise<QaOrderSide> {
  const store: OrderStore = await openOrderStore(
    {
      uri: options.uri ?? directUri(),
      dbName: options.dbName,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: options.operationTimeoutMs ?? STORE_TIMEOUT_MS,
    },
    silentLogger,
    'test',
  );
  cleanups.push(() => store.close());
  const side = orderSide({
    store,
    courierAddress: options.courierAddress,
    clock: options.clock,
    logger: options.lines === undefined ? silentLogger : recordingLogger(options.lines),
  });
  cleanups.push(() => side.close());
  return side;
}

/** Siparisin outbox'taki PAID -> PREPARING olaylari. */
export function preparingEvents(dbName: string, orderId: string): Promise<number> {
  return raw.db(dbName).collection(COLLECTIONS.OUTBOX).countDocuments({
    aggregateId: orderId,
    topic: 'order.status_changed',
    'payload.from': ORDER_STATUS.PAID,
    'payload.to': ORDER_STATUS.PREPARING,
  });
}

export async function ordersOf(side: QaOrderSide, ids: readonly string[]): Promise<Order[]> {
  const found = await Promise.all(ids.map((id) => side.order(id)));
  return found.flatMap((order) => (order === null ? [] : [order]));
}

export async function busyOf(service: QaCourierService, placed: readonly Courier[]) {
  const states = await Promise.all(placed.map((courier) => service.get(courier.id)));
  return states.filter(isBusy);
}

/** Iptal yolu (bugun kod yolu yok; durum tablosunda PAID -> CANCELLED var): siparisi kapatir. */
export async function cancelOrder(side: QaOrderSide, orderId: string): Promise<void> {
  const current = await side.order(orderId);
  if (current === null) throw new Error(`siparis yok: ${orderId}`);
  const cancelled = transitionOrder(current, ORDER_STATUS.CANCELLED, side.clock);
  await side.store.repository.update(
    cancelled,
    current.version,
    statusChangedEvents(current, cancelled),
  );
}
