/**
 * Kurye servisinin gocleri gercek Mongo'da (T10.4, ADR-19). Goc 0001 (T13.2,
 * kurye havuzu) T13.1 bicimindeki kuryeleri havuz bicimine cevirir: konum
 * GeoJSON, marketId yok, IDLE'da bosta bekleme baslangici, eski atama indeksi
 * yok, market konumu kopyasi var. Bitti tanimi: up -> down -> up ayni veriyi
 * verir ve havuz atamasi gocten sonra calisir.
 */

import { silentLogger } from '@getir/core';
import { connectMongo, createMigrationRunner } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COURIER_STATUS } from '../../src/domain/courier.js';
import { CourierMongoStore } from '../../src/infrastructure/mongo/courier-mongo-store.js';
import { CouriersCollection } from '../../src/infrastructure/mongo/couriers-collection.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MarketsCollection } from '../../src/infrastructure/mongo/markets-collection.js';
import { MIGRATIONS } from '../../src/migrations/index.js';
import {
  courierId,
  MARKET,
  MARKET_LOCATION,
  OTHER_MARKET,
  OTHER_MARKET_LOCATION,
  orderId,
  POOL_RULE,
} from '../support/couriers.js';

/**
 * Goc 0001'in yazdigi market sayisi: o gunun DONMUS listesi (ADR-19), 21 market.
 * 07.10 subeleri goc ile degil seed ile gelir (demo verisi 33 market).
 */
const MIGRATION_0001_MARKET_COUNT = 21;

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_courier_goc_test';
const OLD_INDEX = 'marketId_status_lastAssignedAt';

let container: StartedMongoDBContainer;
let connection: MongoConnection;

const couriers = () => connection.db.collection<Document>(COLLECTIONS.COURIERS);
const runner = () =>
  createMigrationRunner({ connection, migrations: MIGRATIONS, logger: silentLogger });

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 4, 8, minute));
const ORDER = orderId();

/** T13.1 bicimi: markete bagli, konum {lat, lng}, bosta bekleme alani yok. */
const T131_COURIERS: Document[] = [
  {
    _id: courierId(1),
    name: 'Kurye 1',
    marketId: MARKET,
    status: COURIER_STATUS.IDLE,
    lastLocation: { lat: MARKET_LOCATION.lat, lng: MARKET_LOCATION.lng },
    lastLocationAt: at(0),
  },
  {
    _id: courierId(2),
    name: 'Kurye 2',
    marketId: OTHER_MARKET,
    status: COURIER_STATUS.IDLE,
    lastAssignedAt: at(10),
    lastLocation: { lat: OTHER_MARKET_LOCATION.lat, lng: OTHER_MARKET_LOCATION.lng },
    lastLocationAt: at(0),
  },
  {
    _id: courierId(3),
    name: 'Kurye 3',
    marketId: MARKET,
    status: COURIER_STATUS.BUSY,
    currentOrderId: ORDER,
    lastAssignedAt: at(20),
    lastLocation: { lat: MARKET_LOCATION.lat, lng: MARKET_LOCATION.lng },
    lastLocationAt: at(0),
  },
];

async function snapshot(): Promise<Document[]> {
  return couriers()
    .find({}, { sort: { _id: 1 } })
    .toArray();
}

async function indexNames(): Promise<string[]> {
  return (await couriers().indexes()).map((index) => String(index.name)).sort();
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    operationTimeoutMs: 2_000,
  });
  await couriers().insertMany(T131_COURIERS);
  await couriers().createIndex(
    { marketId: 1, status: 1, lastAssignedAt: 1, _id: 1 },
    { name: OLD_INDEX },
  );
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describe('goc 0001: kurye havuzu', () => {
  let afterFirstUp: Document[] = [];

  it('up: konum GeoJSON, marketId yok, IDLE kuryeye idleSince (son atama ya da seed ani), BUSY degismez; eski indeks duser; 21 market yazilir', async () => {
    await runner().up();

    afterFirstUp = await snapshot();
    expect(afterFirstUp).toEqual([
      {
        _id: courierId(1),
        name: 'Kurye 1',
        status: COURIER_STATUS.IDLE,
        idleSince: at(0),
        lastLocation: { type: 'Point', coordinates: [MARKET_LOCATION.lng, MARKET_LOCATION.lat] },
        lastLocationAt: at(0),
      },
      {
        _id: courierId(2),
        name: 'Kurye 2',
        status: COURIER_STATUS.IDLE,
        lastAssignedAt: at(10),
        idleSince: at(10),
        lastLocation: {
          type: 'Point',
          coordinates: [OTHER_MARKET_LOCATION.lng, OTHER_MARKET_LOCATION.lat],
        },
        lastLocationAt: at(0),
      },
      {
        _id: courierId(3),
        name: 'Kurye 3',
        status: COURIER_STATUS.BUSY,
        currentOrderId: ORDER,
        lastAssignedAt: at(20),
        lastLocation: { type: 'Point', coordinates: [MARKET_LOCATION.lng, MARKET_LOCATION.lat] },
        lastLocationAt: at(0),
      },
    ]);
    expect(await indexNames()).not.toContain(OLD_INDEX);
    expect(await connection.db.collection(COLLECTIONS.MARKETS).countDocuments()).toBe(
      MIGRATION_0001_MARKET_COUNT,
    );
  });

  it('gocten sonra havuz indeksi kurulur ve atama calisir (kurye 1 marketin tam yerinde)', async () => {
    const collection = new CouriersCollection(connection.db);
    await collection.ensureIndexes();
    const store = new CourierMongoStore(collection, new MarketsCollection(connection.db));

    expect(await store.locate(MARKET)).toEqual(MARKET_LOCATION);
    const order = orderId();
    const claimed = await store.claimNearest({
      orderId: order,
      near: MARKET_LOCATION,
      rule: POOL_RULE,
      at: at(30),
    });
    expect(claimed?.id).toBe(courierId(1));
    await store.releaseByOrder(order, at(0));
    // Gocten hemen sonraki hal (idleSince seed ani) geri gelsin: up -> down -> up karsilastirmasi icin.
    expect(await snapshot()).toEqual(
      afterFirstUp.map((document) =>
        document['_id'] === courierId(1) ? { ...document, lastAssignedAt: at(30) } : document,
      ),
    );
    await couriers().updateOne({ _id: courierId(1) } as Document, {
      $unset: { lastAssignedAt: '' },
    });
  });

  it('down: T13.1 bicimine doner (marketId en yakin marketten); 2dsphere indeksi ve markets duser', async () => {
    await runner().down();

    const restored = await snapshot();
    expect(restored.map((document) => document['marketId'] as unknown)).toEqual([
      MARKET,
      OTHER_MARKET,
      MARKET,
    ]);
    expect(restored.map((document) => document['lastLocation'] as unknown)).toEqual(
      T131_COURIERS.map((document) => document['lastLocation'] as unknown),
    );
    expect(restored.some((document) => 'idleSince' in document)).toBe(false);
    expect(await indexNames()).not.toContain('lastLocation_2dsphere_status');
    const collections = await connection.db
      .listCollections({ name: COLLECTIONS.MARKETS }, { nameOnly: true })
      .toArray();
    expect(collections).toEqual([]);
  });

  it('yeniden up: ilk up ile ayni veri', async () => {
    await runner().up();

    expect(await snapshot()).toEqual(afterFirstUp);
  });
});
