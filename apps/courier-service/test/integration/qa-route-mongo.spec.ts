/**
 * QA kara kutu (T13.2 PR 3, #124: rota ve ETA), gercek Mongo (Testcontainers) ve
 * gercek gRPC. Courier kopyalari uretimdeki acilis yoluyla kurulur
 * (openCourierStore: gocler, indeksler; kurye, market kopyasi ve routes Mongo'da).
 * Backend'in testleri use-case'i bellekte, Mongo deposunu sozlesmeyle ve iki
 * kopyayi sirayla sinar; burada:
 *
 *   Q1 Iki kopyaya ayni siparis icin 16 eszamanli AssignCourier: tek kurye,
 *      tek routes belgesi, butun cevaplarda ayni ETA; StartRoute iki kopyada
 *      birebir ayni; ETA istemcinin distance_meters'tan bulduguyla ayni (B4).
 *   Q2 Rota adiminda courier'in Mongo'su donar (vekil): AssignCourier
 *      SERVICE_UNAVAILABLE, kurye siparise bagli kalir, rota yazilmaz;
 *      cozulunce tekrar istek AYNI kuryeyi ve rotayi verir, tek belge.
 *   Q3 B1, Mongo'da: kopya A birakir, kopya B'nin StartRoute'u NOT_FOUND (rota
 *      gecmis olarak durur); kurye baska siparise gecince eski siparis
 *      NOT_FOUND, yenisi rotasini doner.
 *   Q4 B2, Mongo'da: birak + ayni kuryeye yeniden ata -> rota yenilenir
 *      (startedAt yeni atama ani), belge tek.
 *   Q5 T13.2 PR 1 donemi verisi (atama var, rota yok): tekrar istek rota uretir
 *      (ETA > 0); market kopyada yoksa atama yine doner, ETA 0, WARN, rota yok.
 */

import { fixedClock, GRPC_STATUS, ID_PREFIX, newId } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { courierV1 } from '@getir/proto';
import { appErrorOf } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { FreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import { DEFAULT_COURIER_SPEED_KMH } from '../../src/config/constants.js';
import type { Courier } from '../../src/domain/courier.js';
import type { Route } from '../../src/domain/route.js';
import type { RouteRepository } from '../../src/domain/route-repository.js';
import { openCourierStore } from '../../src/infrastructure/courier-store.js';
import { MARKET_LOCATION_SEEDS } from '../../src/infrastructure/fixtures/couriers.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { CouriersCollection } from '../../src/infrastructure/mongo/couriers-collection.js';
import { MarketsCollection } from '../../src/infrastructure/mongo/markets-collection.js';
import { MongoCourierSeedWriter } from '../../src/infrastructure/mongo/mongo-courier-seed-writer.js';
import {
  courier,
  DELIVERY,
  MARKET,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
} from '../support/couriers.js';
import { outcomeOf, startQaCourierServer } from '../support/qa-courier-harness.js';
import type { QaCourierServer } from '../support/qa-courier-harness.js';

const MONGO_IMAGE = 'mongo:7';
const MONGO_PORT = 27_017;
/** Uretimdeki gibi sureli, yuklu makinede yanlis kirmizi vermesin diye genis. */
const STORE_TIMEOUT_MS = 10_000;
/** Donma testinde tur bu kadar bekler. */
const FROZEN_TIMEOUT_MS = 1_000;
const CONCURRENT_REQUESTS = 16;
const SECOND = 1_000;

let container: StartedMongoDBContainer;
let raw: MongoClient;
const cleanups: (() => Promise<void> | void)[] = [];

const directUri = (): string => `${container.getConnectionString()}/?directConnection=true`;
const freshDb = (): string => `qa_rota_${newId(ID_PREFIX.EVENT).slice(-8)}`;

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

/** Seed komutunun yaptigi: indeks, sonra kuryeler ve demo market kopyasi. */
async function seed(dbName: string, list: readonly Courier[]): Promise<void> {
  const connection: MongoConnection = await connectMongo({
    uri: directUri(),
    dbName,
    operationTimeoutMs: STORE_TIMEOUT_MS,
  });
  try {
    const couriers = new CouriersCollection(connection.db);
    await couriers.ensureIndexes();
    await new MongoCourierSeedWriter(
      connection,
      couriers,
      new MarketsCollection(connection.db),
    ).replaceAll(list, MARKET_LOCATION_SEEDS);
  } finally {
    await connection.close();
  }
}

/** Uretimdeki acilisla bir courier kopyasi (openCourierStore + gRPC sunucusu). */
async function replica(options: {
  readonly dbName: string;
  readonly clock: MutableClock;
  readonly name: string;
  readonly uri?: string;
  readonly operationTimeoutMs?: number;
  readonly lines?: LogLine[];
  readonly wrapRoutes?: (routes: RouteRepository) => RouteRepository;
}): Promise<QaCourierServer> {
  const logger = recordingLogger(options.lines ?? []);
  const store = await openCourierStore(
    {
      uri: options.uri ?? directUri(),
      dbName: options.dbName,
      serverSelectionTimeoutMs: 5_000,
      operationTimeoutMs: options.operationTimeoutMs ?? STORE_TIMEOUT_MS,
    },
    { logger, clock: options.clock },
  );
  cleanups.push(() => store.close());
  const server = await startQaCourierServer({
    repository: store.repository,
    markets: store.markets,
    routes: options.wrapRoutes === undefined ? store.routes : options.wrapRoutes(store.routes),
    clock: options.clock,
    logger,
    name: options.name,
  });
  cleanups.push(() => server.stop());
  return server;
}

const routesOf = (dbName: string) => raw.db(dbName).collection<Document>(COLLECTIONS.ROUTES);

async function routeDocs(dbName: string, order: string): Promise<Document[]> {
  return routesOf(dbName)
    .find({ _id: order } as Document)
    .toArray();
}

/** distance_meters'tan istemcinin bulacagi ETA (B4: tek kaynak). */
const clientEta = (distanceMeters: number, speedKmh = DEFAULT_COURIER_SPEED_KMH): number =>
  Math.ceil((distanceMeters * 3_600) / (speedKmh * 1_000));

function grpcCodeOf(result: {
  readonly error?: { readonly code: number } | undefined;
}): number | undefined {
  return result.error?.code;
}

describe('QA T13.2 PR 3 rota, gercek Mongo + gercek gRPC', () => {
  it('Q1 iki kopyaya ayni siparis icin 16 eszamanli AssignCourier: tek kurye, tek rota belgesi, ayni ETA; StartRoute iki kopyada birebir', async () => {
    const dbName = freshDb();
    const clock = fixedClock(NOW_MS);
    await seed(dbName, [
      courier(1, { lastLocation: northOf(MARKET_LOCATION, 600) }),
      courier(2, { lastLocation: northOf(MARKET_LOCATION, 900) }),
      courier(3, { lastLocation: northOf(MARKET_LOCATION, 1_200) }),
    ]);
    const a = await replica({ dbName, clock, name: 'courier-qa-rota-a' });
    const b = await replica({ dbName, clock, name: 'courier-qa-rota-b' });
    const order = orderId();

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, index) =>
        (index % 2 === 0 ? a : b).assign(order, MARKET, DELIVERY),
      ),
    );
    const outcomes = results.map(outcomeOf);
    const couriers = new Set(
      outcomes.map((outcome) => (outcome.kind === 'atandi' ? outcome.courierId : 'hata')),
    );
    const etas = new Set(results.map((result) => result.response?.etaSeconds));
    const [holder] = couriers;
    const fromA = await a.startRoute(order, holder ?? '');
    const fromB = await b.startRoute(order, holder ?? '');
    const route = fromA.response?.route;

    expect(couriers.size).toBe(1);
    expect(holder).not.toBe('hata');
    expect(etas.size).toBe(1);
    expect(await routeDocs(dbName, order)).toHaveLength(1);
    expect(fromA.error).toBeUndefined();
    expect(fromB.response).toEqual(fromA.response);
    expect(fromA.response?.alreadyStarted).toBe(true);
    expect(fromA.response?.startedAt).toEqual(new Date(NOW_MS));
    expect(route?.points.at(-1)).toEqual(DELIVERY);
    expect(
      route?.points.some(
        (point) => point.lat === MARKET_LOCATION.lat && point.lng === MARKET_LOCATION.lng,
      ),
    ).toBe(true);
    expect([...etas][0]).toBe(route?.etaSeconds);
    expect(route?.etaSeconds).toBe(clientEta(route?.distanceMeters ?? -1));
    expect(route?.etaSeconds).toBeGreaterThan(0);
  });

  it('Q2 rota adiminda courier in Mongo su donar: AssignCourier SERVICE_UNAVAILABLE, kurye bagli, rota yok; cozulunce ayni kurye ve rota, tek belge', async () => {
    const dbName = freshDb();
    const clock = fixedClock(NOW_MS);
    await seed(dbName, [courier(1, { lastLocation: northOf(MARKET_LOCATION, 700) })]);
    const proxy: FreezingProxy = await startFreezingProxy({
      host: container.getHost(),
      port: container.getMappedPort(MONGO_PORT),
    });
    cleanups.push(() => proxy.close());
    cleanups.push(() => proxy.thaw());
    let armed = false;
    // Kurye talep edildi (findAndModify bitti); siradaki Mongo islemi rotanin okunmasi: orada donar.
    const frozenOnRoute = (routes: RouteRepository): RouteRepository => ({
      findByOrder: (order) => {
        if (armed) {
          armed = false;
          proxy.freeze();
        }
        return routes.findByOrder(order);
      },
      insertOnce: (route: Route) => routes.insertOnce(route),
      replace: (route: Route) => routes.replace(route),
    });
    const frozen = await replica({
      dbName,
      clock,
      name: 'courier-qa-rota-donar',
      uri: `mongodb://127.0.0.1:${proxy.port}/?directConnection=true`,
      operationTimeoutMs: FROZEN_TIMEOUT_MS,
      wrapRoutes: frozenOnRoute,
    });
    const observer = await replica({ dbName, clock, name: 'courier-qa-rota-gozcu' });
    const order = orderId();

    armed = true;
    const lost = await frozen.assign(order, MARKET, DELIVERY);
    proxy.thaw();
    const bound = await observer.get(courier(1).id);
    const routesWhileLost = await routeDocs(dbName, order);
    let retried = await frozen.assign(order, MARKET, DELIVERY);
    for (let attempt = 0; attempt < 20 && retried.error !== undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      retried = await frozen.assign(order, MARKET, DELIVERY);
    }
    const started = await observer.startRoute(order, courier(1).id);

    expect(grpcCodeOf(lost)).toBe(GRPC_STATUS.UNAVAILABLE);
    expect(appErrorOf(lost.error)?.code).toBe('SERVICE_UNAVAILABLE');
    expect(bound.response?.courier?.status).toBe(courierV1.CourierStatus.COURIER_STATUS_BUSY);
    expect(bound.response?.courier?.currentOrderId).toBe(order);
    expect(routesWhileLost).toHaveLength(0);
    expect(outcomeOf(retried)).toEqual({
      kind: 'atandi',
      courierId: courier(1).id,
      orderId: order,
    });
    expect(retried.response?.etaSeconds).toBeGreaterThan(0);
    expect(await routeDocs(dbName, order)).toHaveLength(1);
    expect(started.response?.route?.etaSeconds).toBe(retried.response?.etaSeconds);
  });

  it('Q3 B1 Mongo da: A birakir, B nin StartRoute u NOT_FOUND ve rota gecmis olarak durur; kurye baska siparise gecince eskisi NOT_FOUND, yenisi rotasini doner', async () => {
    const dbName = freshDb();
    const clock = fixedClock(NOW_MS);
    await seed(dbName, [courier(1, { lastLocation: northOf(MARKET_LOCATION, 500) })]);
    const a = await replica({ dbName, clock, name: 'courier-qa-b1-a' });
    const b = await replica({ dbName, clock, name: 'courier-qa-b1-b' });
    const first = orderId();
    const second = orderId();
    const holder = courier(1).id;

    expect(outcomeOf(await a.assign(first, MARKET, DELIVERY)).kind).toBe('atandi');
    expect((await a.release(first)).response?.released).toBe(true);
    const afterRelease = await b.startRoute(first, holder);
    const keptAsHistory = await routeDocs(dbName, first);
    clock.advance(5 * SECOND);
    expect(outcomeOf(await b.assign(second, MARKET, DELIVERY))).toEqual({
      kind: 'atandi',
      courierId: holder,
      orderId: second,
    });
    const oldOrder = await a.startRoute(first, holder);
    const newOrder = await a.startRoute(second, holder);

    expect(grpcCodeOf(afterRelease)).toBe(GRPC_STATUS.NOT_FOUND);
    expect(keptAsHistory).toHaveLength(1);
    expect(grpcCodeOf(oldOrder)).toBe(GRPC_STATUS.NOT_FOUND);
    expect(newOrder.error).toBeUndefined();
    expect(newOrder.response?.startedAt).toEqual(new Date(NOW_MS + 5 * SECOND));
  });

  it('Q4 B2 Mongo da: birak + ayni kuryeye ayni siparisi yeniden ata -> rota yenilenir (startedAt yeni atama ani), belge tek', async () => {
    const dbName = freshDb();
    const clock = fixedClock(NOW_MS);
    await seed(dbName, [courier(1, { lastLocation: northOf(MARKET_LOCATION, 800) })]);
    const a = await replica({ dbName, clock, name: 'courier-qa-b2-a' });
    const b = await replica({ dbName, clock, name: 'courier-qa-b2-b' });
    const order = orderId();
    const holder = courier(1).id;

    const assigned = await a.assign(order, MARKET, DELIVERY);
    const before = await b.startRoute(order, holder);
    clock.advance(5 * SECOND);
    expect((await b.release(order)).response?.released).toBe(true);
    clock.advance(5 * SECOND);
    const reassigned = await b.assign(order, MARKET, DELIVERY);
    const after = await a.startRoute(order, holder);
    const docs = await routeDocs(dbName, order);

    expect(outcomeOf(assigned).kind).toBe('atandi');
    expect(before.response?.startedAt).toEqual(new Date(NOW_MS));
    expect(outcomeOf(reassigned)).toEqual({ kind: 'atandi', courierId: holder, orderId: order });
    expect(after.response?.startedAt).toEqual(new Date(NOW_MS + 10 * SECOND));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.['createdAt']).toEqual(new Date(NOW_MS + 10 * SECOND));
    // Kurye birakilinca yer degistirmez: ayni noktalar, ayni ETA.
    expect(after.response?.route).toEqual(before.response?.route);
  });

  it('Q5 T13.2 PR 1 donemi verisi (atama var, rota yok): tekrar istek rota uretir; market kopyada yoksa atama doner, ETA 0, tek WARN, rota yok', async () => {
    const dbName = freshDb();
    const clock = fixedClock(NOW_MS);
    await seed(dbName, [
      courier(1, { lastLocation: northOf(MARKET_LOCATION, 400) }),
      courier(2, { lastLocation: northOf(MARKET_LOCATION, 450) }),
    ]);
    const lines: LogLine[] = [];
    const service = await replica({ dbName, clock, name: 'courier-qa-eski-veri', lines });
    const withMarket = orderId();
    const withoutMarket = orderId();
    const firstHolder = outcomeOf(await service.assign(withMarket, MARKET, DELIVERY));
    const secondHolder = outcomeOf(await service.assign(withoutMarket, MARKET, DELIVERY));
    // Atamalar rota gelmeden once yapilmis gibi: rota belgeleri yok.
    await routesOf(dbName).deleteMany({});
    clock.advance(30 * SECOND);

    const again = await service.assign(withMarket, MARKET, DELIVERY);
    const regenerated = await routeDocs(dbName, withMarket);
    // Marketin kopyasi silinmis (veri hatasi): atama yine doner, rota uretilemez.
    await raw
      .db(dbName)
      .collection<Document>(COLLECTIONS.MARKETS)
      .deleteOne({ _id: MARKET } as Document);
    const warnsBefore = lines.filter((line) => line.level === 'warn').length;
    const unknownMarket = await service.assign(withoutMarket, MARKET, DELIVERY);
    const warns = lines.filter((line) => line.level === 'warn').slice(warnsBefore);
    const noRoute = await service.startRoute(
      withoutMarket,
      secondHolder.kind === 'atandi' ? secondHolder.courierId : '',
    );

    expect(outcomeOf(again)).toEqual(firstHolder);
    expect(again.response?.etaSeconds).toBeGreaterThan(0);
    expect(regenerated).toHaveLength(1);
    expect(regenerated[0]?.['createdAt']).toEqual(new Date(NOW_MS + 30 * SECOND));
    expect(outcomeOf(unknownMarket)).toEqual(secondHolder);
    expect(unknownMarket.response?.etaSeconds).toBe(0);
    expect(warns.map((line) => line.message)).toEqual([
      'rota uretilemedi: market konumu bilinmiyor',
    ]);
    expect(await routeDocs(dbName, withoutMarket)).toHaveLength(0);
    expect(grpcCodeOf(noRoute)).toBe(GRPC_STATUS.NOT_FOUND);
  });
});
