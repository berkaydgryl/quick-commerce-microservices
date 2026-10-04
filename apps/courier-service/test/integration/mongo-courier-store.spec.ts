/**
 * couriers'in Mongo uygulamasi - gercek Mongo (Testcontainers).
 *   1. Sozlesme: bellek deposuyla AYNI senaryolar gercek sorguda ($geoNear).
 *   2. Indeksler: havuz sorgusu 2dsphere indeksinden okunur; currentOrderId
 *      benzersiz ve kismi.
 *   3. B7 (havuz): tek bos kurye ya da az kurye, eszamanli cok siparis ->
 *      kurye bolunmez, fazla siparis NOT_FOUND; adaylar kosullu alinir.
 *      Bos kurye varken NOT_FOUND yok (yogun eszamanlilik, QA O1); kaybedilen
 *      aday ayni talepte yeniden denenmez, dongu havuz buyuklugunde biter.
 *   4. Tekrar: ayni siparis eszamanli istense de tek kurye baglanir.
 *   5. Semtler karismaz: Besiktas siparisi Kadikoy kuryesini almaz.
 *   6. Acilis (gocler + indeksler + market kopyasi) ve seed (transaction,
 *      tekrar kosunca sifirlar).
 */

import { ERROR_CODES, fixedClock, GRPC_STATUS, ID_PREFIX, newId, silentLogger } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { courierV1 } from '@getir/proto';
import { appErrorOf, startTestGrpcServer } from '@getir/service-kit/testing';
import type { TestGrpcServer } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSeedCouriers } from '../../src/application/seed-couriers.js';
import { buildCourierService } from '../../src/bootstrap.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Courier } from '../../src/domain/courier.js';
import { openCourierStore } from '../../src/infrastructure/courier-store.js';
import {
  COURIER_SEEDS,
  MARKET_LOCATION_SEEDS,
} from '../../src/infrastructure/fixtures/couriers.js';
import { CourierMongoStore } from '../../src/infrastructure/mongo/courier-mongo-store.js';
import { CouriersCollection } from '../../src/infrastructure/mongo/couriers-collection.js';
import type { CourierDocument } from '../../src/infrastructure/mongo/documents.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { toGeoJson } from '../../src/infrastructure/mongo/mappers.js';
import { MarketsCollection } from '../../src/infrastructure/mongo/markets-collection.js';
import { MongoCourierSeedWriter } from '../../src/infrastructure/mongo/mongo-courier-seed-writer.js';
import { describeCourierStoreContract } from '../support/courier-store-contract.js';
import {
  courier,
  DELIVERY,
  FAR_MARKET,
  FAR_MARKET_LOCATION,
  MARKET,
  MARKET_LOCATION,
  northOf,
  NOW_MS,
  orderId,
  OTHER_MARKET,
  POOL_RULE,
  TEST_MARKETS,
} from '../support/couriers.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_courier_test';

/** Eszamanli istek sayisi: tek bos kuryeye yarisan siparisler. */
const RACERS = 20;

/** Kaybedilen aday testinde okuma siniri: dislama bozulursa dongu burada durur. */
const MAX_CANDIDATE_READS = 10;

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let couriers: CouriersCollection;
let markets: MarketsCollection;
let store: CourierMongoStore;
let writer: MongoCourierSeedWriter;

/** Koleksiyonlari verilen kuryeler ve test marketleriyle bastan yazar (seed yazicisi: tek transaction). */
async function reset(list: readonly Courier[]): Promise<CourierMongoStore> {
  await writer.replaceAll(list, TEST_MARKETS);
  return store;
}

/** MARKET'in `meters` kuzeyinde IDLE kurye. */
const near = (order: number, meters: number): Courier =>
  courier(order, { lastLocation: northOf(MARKET_LOCATION, meters) });

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: `${container.getConnectionString()}?directConnection=true`,
    dbName: DB_NAME,
    // Uretimdeki gibi sureli (#51): atama ve transaction bu ayarla kosar.
    operationTimeoutMs: 2_000,
  });
  couriers = new CouriersCollection(connection.db);
  markets = new MarketsCollection(connection.db);
  await couriers.ensureIndexes();
  store = new CourierMongoStore(couriers, markets);
  writer = new MongoCourierSeedWriter(connection, couriers, markets);
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

describeCourierStoreContract('mongo', reset);

describe('indeksler', () => {
  it('havuz indeksi (2dsphere + durum) ve kismi benzersiz currentOrderId kurulu; eski market indeksi yok', async () => {
    const indexes = await connection.db.collection(COLLECTIONS.COURIERS).indexes();
    const byName = (name: string) => indexes.find((index) => index.name === name);

    expect(byName('lastLocation_2dsphere_status')?.key).toEqual({
      lastLocation: '2dsphere',
      status: 1,
    });
    expect(byName('currentOrderId_unique')).toMatchObject({
      key: { currentOrderId: 1 },
      unique: true,
      partialFilterExpression: { currentOrderId: { $exists: true } },
    });
    expect(byName('marketId_status_lastAssignedAt')).toBeUndefined();
  });

  it('havuz sorgusu ($geoNear) 2dsphere indeksinden okur, koleksiyonu taramaz', async () => {
    await reset([near(1, 100), near(2, 200)]);

    // couriers-collection.ts poolCandidates ile ayni ilk asama.
    const plan = await connection.db
      .collection(COLLECTIONS.COURIERS)
      .aggregate([
        {
          $geoNear: {
            near: toGeoJson(MARKET_LOCATION),
            key: 'lastLocation',
            distanceField: 'distanceMeters',
            maxDistance: POOL_RULE.radiusMeters,
            query: { status: COURIER_STATUS.IDLE },
            spherical: true,
          },
        },
        { $limit: 5 },
      ])
      .explain();

    const text = JSON.stringify(plan);
    expect(text).toContain('GEO_NEAR_2DSPHERE');
    expect(text).toContain('lastLocation_2dsphere_status');
    expect(text).not.toContain('COLLSCAN');
  });
});

describe('gRPC uzerinden eszamanli atama (gercek Mongo, havuz)', () => {
  let server: TestGrpcServer | undefined;

  const assign = async (order: string, marketId = MARKET) => {
    if (server === undefined) throw new Error('test sunucusu henuz baslamadi');
    return server.call(
      courierV1.CourierServiceService.assignCourier,
      courierV1.AssignCourierRequest.fromPartial({
        orderId: order,
        marketId,
        deliveryLocation: DELIVERY,
      }),
    );
  };

  beforeAll(async () => {
    server = await startTestGrpcServer({
      serviceName: 'courier-int',
      services: [
        buildCourierService({ couriers: store, markets: store, clock: fixedClock(NOW_MS) }),
      ],
    });
  });

  afterAll(async () => {
    await server?.stop();
  });

  it(`B7: tek bos kurye, ${RACERS} eszamanli siparis -> biri atanir, digerleri NOT_FOUND`, async () => {
    await reset([near(1, 100)]);
    const orders = Array.from({ length: RACERS }, () => orderId());

    const results = await Promise.all(orders.map((order) => assign(order)));

    const winners = results.filter((result) => result.error === undefined);
    const losers = results.filter((result) => result.error !== undefined);
    expect(winners).toHaveLength(1);
    expect(losers.map((result) => result.error?.code)).toEqual(
      Array.from({ length: RACERS - 1 }, () => GRPC_STATUS.NOT_FOUND),
    );
    const holder = await couriers.findById(near(1, 100).id);
    expect(holder?.status).toBe(COURIER_STATUS.BUSY);
    expect(holder?.currentOrderId).toBe(winners[0]?.response?.courier?.currentOrderId);
  });

  it('havuzda 5 kurye (ikisi havuz disinda), iki markete 30 eszamanli siparis: tam 5 atama, 5 farkli kurye; disaridakiler bos kalir', async () => {
    await reset([
      near(1, 100),
      near(2, 400),
      near(3, 900),
      near(4, 1_500),
      courier(5, { lastLocation: northOf(MARKET_LOCATION, 2_500) }),
      courier(6, { lastLocation: northOf(MARKET_LOCATION, 7_000) }),
      courier(7, { lastLocation: FAR_MARKET_LOCATION }),
    ]);
    const orders = Array.from({ length: 30 }, (_, index) => ({
      order: orderId(),
      market: index % 2 === 0 ? MARKET : OTHER_MARKET,
    }));

    const results = await Promise.all(orders.map(({ order, market }) => assign(order, market)));

    const assigned = results.flatMap((result) => result.response?.courier?.id ?? []);
    expect(assigned).toHaveLength(5);
    expect(new Set(assigned).size).toBe(5);
    expect(
      results.flatMap((result) => (result.error === undefined ? [] : [result.error.code])),
    ).toEqual(Array(25).fill(GRPC_STATUS.NOT_FOUND));
    expect(await couriers.count({ status: COURIER_STATUS.BUSY })).toBe(5);
    expect((await couriers.findById(courier(6).id))?.status).toBe(COURIER_STATUS.IDLE);
    expect((await couriers.findById(courier(7).id))?.status).toBe(COURIER_STATUS.IDLE);
    // Her BUSY kurye kendi siparisini tasir; siparis basina tek kurye.
    const busy = await connection.db
      .collection(COLLECTIONS.COURIERS)
      .find({ status: COURIER_STATUS.BUSY })
      .toArray();
    expect(new Set(busy.map((one) => one['currentOrderId'] as unknown)).size).toBe(5);
  });

  it('30 bos kurye ayni noktada, 20 eszamanli siparis: tam 20 atama, 20 farkli kurye, NOT_FOUND yok (5 tur, QA O1)', async () => {
    for (let round = 0; round < 5; round += 1) {
      await reset(Array.from({ length: 30 }, (_, index) => courier(index + 1)));

      const results = await Promise.all(Array.from({ length: 20 }, () => assign(orderId())));

      expect(
        results.flatMap((result) => (result.error === undefined ? [] : [result.error.code])),
        `tur ${round}`,
      ).toEqual([]);
      const assigned = results.flatMap((result) => result.response?.courier?.id ?? []);
      expect(new Set(assigned).size, `tur ${round}`).toBe(20);
      expect(await couriers.count({ status: COURIER_STATUS.BUSY }), `tur ${round}`).toBe(20);
    }
  });

  it('Besiktas siparisi Kadikoy kuryesini almaz; kendi semtindeki kuryeyi alir', async () => {
    await reset([near(1, 100), courier(2, { lastLocation: northOf(FAR_MARKET_LOCATION, 200) })]);

    const besiktas = await assign(orderId(), FAR_MARKET);
    const again = await assign(orderId(), FAR_MARKET);

    expect(besiktas.response?.courier?.id).toBe(courier(2).id);
    expect(again.error?.code).toBe(GRPC_STATUS.NOT_FOUND);
    expect((await couriers.findById(courier(1).id))?.status).toBe(COURIER_STATUS.IDLE);
  });

  it('ayni siparis eszamanli 10 kez istenir: hepsi ayni kuryeyi alir, tek kurye BUSY', async () => {
    await reset([near(1, 100), near(2, 200), near(3, 300)]);
    const order = orderId();

    const results = await Promise.all(Array.from({ length: 10 }, () => assign(order)));

    expect(results.map((result) => result.error)).toEqual(Array(10).fill(undefined));
    const ids = new Set(results.map((result) => result.response?.courier?.id));
    expect(ids.size).toBe(1);
    expect(await couriers.count({ status: COURIER_STATUS.BUSY })).toBe(1);
  });

  it('TEK kurye, ayni siparis eszamanli 10 kez: hepsi o kuryeyi alir, NOT_FOUND yok (QA B1)', async () => {
    await reset([near(1, 100)]);
    const order = orderId();

    const results = await Promise.all(Array.from({ length: 10 }, () => assign(order)));

    expect(results.map((result) => result.error?.code)).toEqual(Array(10).fill(undefined));
    expect(new Set(results.map((result) => result.response?.courier?.id))).toEqual(
      new Set([courier(1).id]),
    );
    expect((await couriers.findById(courier(1).id))?.currentOrderId).toBe(order);
  });

  it('sozlesme disi siparis kimligi depoya hic ulasmaz', async () => {
    await reset([near(1, 100)]);

    const { error } = await assign(newId(ID_PREFIX.USER));

    expect(appErrorOf(error)?.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((await couriers.findById(courier(1).id))?.status).toBe(COURIER_STATUS.IDLE);
  });
});

/**
 * Adayi her denemede "baskasi kapti" der ama belge IDLE kalir: talebin okumasi
 * ile kosullu yazimi arasinda atanip hemen birakilan kurye. Bu aday ayni
 * talepte yeniden okunmamali; okuma sinirli, dislama bozulursa test durur.
 */
class ChurningCouriers extends CouriersCollection {
  readonly attempts: string[] = [];
  reads = 0;

  constructor(
    db: MongoConnection['db'],
    private readonly churning: ReadonlySet<string>,
  ) {
    super(db);
  }

  override async poolCandidates(
    ...args: Parameters<CouriersCollection['poolCandidates']>
  ): Promise<string[]> {
    this.reads += 1;
    if (this.reads > MAX_CANDIDATE_READS) {
      throw new Error('aday okumasi bitmiyor: kaybedilen aday yeniden okunuyor');
    }
    return super.poolCandidates(...args);
  }

  override async claimIfIdle(
    courierId: string,
    orderId: string,
    at: Date,
  ): Promise<CourierDocument | null> {
    this.attempts.push(courierId);
    return this.churning.has(courierId) ? null : super.claimIfIdle(courierId, orderId, at);
  }
}

describe('atomik talep: kaybedilen aday ayni talepte yeniden denenmez', () => {
  /** Okuma basina tek aday: her kayip yeni bir okumaya yol acar. */
  const churningStore = (churning: readonly number[]) => {
    const collection = new ChurningCouriers(
      connection.db,
      new Set(churning.map((order) => courier(order).id)),
    );
    return { collection, store: new CourierMongoStore(collection, markets, { candidates: 1 }) };
  };

  const claim = (store: CourierMongoStore) =>
    store.claimNearest({
      orderId: orderId(),
      near: MARKET_LOCATION,
      rule: POOL_RULE,
      at: new Date(NOW_MS),
    });

  it('arada atanip birakilan (yeniden IDLE gorunen) aday dislanir; siradaki alinir', async () => {
    await reset([near(1, 100), near(2, 400)]);
    const { collection, store: churning } = churningStore([1]);

    const claimed = await claim(churning);

    expect(claimed?.id).toBe(courier(2).id);
    expect(collection.attempts).toEqual([courier(1).id, courier(2).id]);
  });

  it('butun adaylar kaybedilirse her aday bir kez denenir ve null doner (ust sinir havuz buyuklugu)', async () => {
    await reset([
      near(1, 100),
      near(2, 400),
      near(3, 900),
      courier(4, { lastLocation: FAR_MARKET_LOCATION }),
    ]);
    const { collection, store: churning } = churningStore([1, 2, 3]);

    expect(await claim(churning)).toBeNull();
    expect(collection.attempts).toEqual([courier(1).id, courier(2).id, courier(3).id]);
    // Uc aday ve havuzun bos oldugunu goren son okuma.
    expect(collection.reads).toBe(4);
  });
});

describe('acilis ve seed', () => {
  it('openCourierStore bos veritabaninda gocu, indeksleri ve market kopyasini kurar', async () => {
    const otherDb = 'getir_courier_acilis';
    const opened = await openCourierStore(
      {
        uri: `${container.getConnectionString()}?directConnection=true`,
        dbName: otherDb,
        serverSelectionTimeoutMs: 5_000,
        operationTimeoutMs: 2_000,
      },
      { logger: silentLogger, clock: fixedClock(NOW_MS) },
    );

    try {
      expect(opened.name).toBe('mongo');
      const names = (await connection.client.db(otherDb).collection(COLLECTIONS.COURIERS).indexes())
        .map((index) => index.name)
        .sort();
      expect(names).toEqual(['_id_', 'currentOrderId_unique', 'lastLocation_2dsphere_status']);
      expect(await opened.repository.findById(courier(1).id)).toBeNull();
      // Goc 0001 bos veritabaninda da market konumlarini yazar (seed beklemeden).
      expect(await opened.markets.locate(MARKET)).toEqual(MARKET_LOCATION);
      expect(
        await connection.client.db(otherDb).collection(COLLECTIONS.MARKETS).countDocuments(),
      ).toBe(MARKET_LOCATION_SEEDS.length);
    } finally {
      await opened.close();
    }
  });

  it('seed demo kuryelerini ve 21 marketi yazar; tekrar kosunca atanmis kurye IDLE a doner', async () => {
    const seed = createSeedCouriers({
      writer,
      seeds: COURIER_SEEDS,
      markets: MARKET_LOCATION_SEEDS,
      isProduction: false,
      clock: fixedClock(NOW_MS),
    });

    expect(await seed()).toEqual({ markets: 21, couriers: 63 });
    expect(await store.locate(FAR_MARKET)).toEqual(FAR_MARKET_LOCATION);
    const claimed = await store.claimNearest({
      orderId: orderId(),
      near: MARKET_LOCATION,
      rule: POOL_RULE,
      at: new Date(NOW_MS),
    });
    expect(claimed).not.toBeNull();
    expect(await couriers.count({ status: COURIER_STATUS.BUSY })).toBe(1);

    await seed();

    expect(await couriers.count({})).toBe(63);
    expect(await couriers.count({ status: COURIER_STATUS.IDLE })).toBe(63);
  });
});
