/**
 * Iptal yolu - gercek Mongo (Testcontainers), #174 ve #177:
 *
 *   1. Kurye kimligiyle birakma {_id, currentOrderId} _id indeksiyle okur
 *      (findAndModify plani: _id_ ya da IDHACK; currentOrderId_unique DEGIL).
 *   2. ReleaseCourier: kurye rotadaki hesaplanan konumda bosa cikar, rota ENDED.
 *   3. Teslim ani kayitli rotada iptal kaybeder: kurye birakilmaz, rota ENDED olmaz.
 * Depo kosulu (ENDED teslimli rotaya yazilmaz) sozlesmede de kosar
 * (moving-route-store-contract, mongo-courier-store.spec).
 */

import { fixedClock, silentLogger } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createReleaseCourier } from '../../src/application/release-courier.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import { ROUTE_STATE } from '../../src/domain/route.js';
import type { Route } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import { routeProgress } from '../../src/domain/route-progress.js';
import { CourierMongoStore } from '../../src/infrastructure/mongo/courier-mongo-store.js';
import {
  CouriersCollection,
  RELEASE_BY_COURIER_HINT,
  releaseFilter,
} from '../../src/infrastructure/mongo/couriers-collection.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MarketsCollection } from '../../src/infrastructure/mongo/markets-collection.js';
import { MongoCourierSeedWriter } from '../../src/infrastructure/mongo/mongo-courier-seed-writer.js';
import { RouteMongoStore } from '../../src/infrastructure/mongo/route-mongo-store.js';
import { RoutesCollection } from '../../src/infrastructure/mongo/routes-collection.js';
import {
  courier,
  courierId,
  DELIVERY,
  MARKET,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
  ROUTE_RULE,
  TEST_MARKETS,
} from '../support/couriers.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_courier_release_test';
const RULE = { speedKmh: 36, prepSeconds: 30 };
const ASSIGNED_AT = northOf(MARKET_LOCATION, 600);

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let store: CourierMongoStore;
let writer: MongoCourierSeedWriter;
let routes: RouteMongoStore;
let order: string;
let route: Route;

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    operationTimeoutMs: 2_000,
  });
  const couriers = new CouriersCollection(connection.db);
  const markets = new MarketsCollection(connection.db);
  await couriers.ensureIndexes();
  store = new CourierMongoStore(couriers, markets);
  writer = new MongoCourierSeedWriter(connection, couriers, markets);
  routes = new RouteMongoStore(new RoutesCollection(connection.db));
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

beforeEach(async () => {
  order = orderId();
  await writer.replaceAll(
    [
      courier(1, {
        status: COURIER_STATUS.BUSY,
        currentOrderId: order,
        lastLocation: ASSIGNED_AT,
        lastAssignedAt: new Date(NOW_MS),
      }),
    ],
    TEST_MARKETS,
  );
  route = await routes.insertOnce({
    orderId: order,
    courierId: courierId(1),
    ...planRoute({ from: ASSIGNED_AT, pickup: MARKET_LOCATION, dropoff: DELIVERY }, ROUTE_RULE),
    createdAt: new Date(NOW_MS),
    marketId: MARKET,
    movement: RULE,
    state: ROUTE_STATE.MOVING,
  });
});

const releaseAt = (ms: number) =>
  createReleaseCourier({ couriers: store, routes, rule: RULE, clock: fixedClock(ms) })(
    order,
    silentLogger,
  );

describe('iptal yolu - gercek Mongo (#174, #177)', () => {
  it('kurye kimligiyle birakma _id indeksiyle okunur (findAndModify plani)', async () => {
    const plan: unknown = await connection.db.command({
      explain: {
        findAndModify: COLLECTIONS.COURIERS,
        query: releaseFilter(order, courierId(1)),
        update: { $set: { status: COURIER_STATUS.IDLE }, $unset: { currentOrderId: '' } },
        hint: RELEASE_BY_COURIER_HINT,
      },
      verbosity: 'queryPlanner',
    });

    // explain dis veridir ve surume gore iki bicimdedir: yalnizca metin olarak aranir.
    const text = JSON.stringify(plan);
    expect(text.includes('"_id_"') || text.includes('IDHACK')).toBe(true);
    expect(text).not.toContain('currentOrderId_unique');
    expect(text).not.toContain('COLLSCAN');
  });

  it('ReleaseCourier: kurye rotadaki hesaplanan konumda IDLE, rota ENDED (#174)', async () => {
    const at = new Date(NOW_MS + 30_000);
    const expected = routeProgress(route, at, RULE).position;

    expect(await releaseAt(at.getTime())).toEqual({ released: true, courierId: courierId(1) });

    const released = await store.findById(courierId(1));
    expect(released?.status).toBe(COURIER_STATUS.IDLE);
    expect(released?.lastLocation.lat).toBeCloseTo(expected.lat, 9);
    expect(released?.lastLocation.lng).toBeCloseTo(expected.lng, 9);
    expect(released?.lastLocationAt).toEqual(at);
    expect((await routes.findByOrder(order))?.state).toBe(ROUTE_STATE.ENDED);
  });

  it('teslim ani kayitli rotada iptal kaybeder: kurye BUSY kalir, rota ENDED olmaz (#177)', async () => {
    await routes.update(route, { deliveredAt: new Date(NOW_MS + 200_000) });

    expect(await releaseAt(NOW_MS + 201_000)).toEqual({ released: false });

    expect((await store.findById(courierId(1)))?.status).toBe(COURIER_STATUS.BUSY);
    expect((await routes.findByOrder(order))?.state).toBe(ROUTE_STATE.MOVING);
  });
});
