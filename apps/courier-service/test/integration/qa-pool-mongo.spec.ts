/**
 * QA kara kutu (T13.2 PR 1, kurye havuzu), gercek Mongo + gercek gRPC.
 *
 *   1. Yogunluk (QA O1'in kalici hali): IKI courier kopyasi, ayni noktada 60 kurye /
 *      40 siparis ve kuryeden fazla siparis (30 / 40): bos kurye varken NOT_FOUND yok;
 *      havuz bitince tam kurye sayisi kadar atama, kurye basina tek siparis.
 *   2. Sinirlar yone bagli degil ve bellek ile Mongo AYNI: 3 km'nin 10 m ici/disi ve
 *      300 m diliminin 10 m oncesi/sonrasi; kuzey, dogu, guney, bati ve caprazlar.
 *      Bellek haversine, Mongo $geoNear hesaplar; sinirda ayrisirlarsa MOCK ile canli
 *      farkli kuryeyi secer.
 *   3. Adil sira uzun kosuda (#88), Mongo'da: ayni dilimde ata-birak dongusunde kuryeler
 *      siraya girer; ust dilimdeki kurye alt dilim bosken hic secilmez, dolunca secilir.
 *
 * Backend'in kapsadiklari (sozlesmede kuzeyde 2,9/3,1 km, tek kopyada 30/20, semt
 * ayrimi, $geoNear plani) burada yinelenmez.
 */

import { fixedClock, GRPC_STATUS } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { courierV1 } from '@getir/proto';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  COURIER_PROXIMITY_BAND_METERS,
  COURIER_POOL_RADIUS_METERS,
} from '../../src/config/constants.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Courier, GeoPoint } from '../../src/domain/courier.js';
import { MARKET_LOCATION_SEEDS } from '../../src/infrastructure/fixtures/couriers.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { CourierMongoStore } from '../../src/infrastructure/mongo/courier-mongo-store.js';
import { CouriersCollection } from '../../src/infrastructure/mongo/couriers-collection.js';
import { MarketsCollection } from '../../src/infrastructure/mongo/markets-collection.js';
import { MongoCourierSeedWriter } from '../../src/infrastructure/mongo/mongo-courier-seed-writer.js';
import {
  courier,
  courierId,
  MARKET,
  MARKET_LOCATION,
  NOW_MS,
  orderId,
} from '../support/couriers.js';
import { outcomeOf, startQaCourierServer } from '../support/qa-courier-harness.js';
import type { QaCourierServer } from '../support/qa-courier-harness.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_courier_qa_havuz';
/** Uretimdeki gibi sureli, yuklu makinede yanlis kirmizi vermesin diye genis. */
const STORE_TIMEOUT_MS = 10_000;
/** Sinirin ne kadar icine/disina konur (m): bellek ile Mongo'nun ayrisabilecegi bolge. */
const EDGE_MARGIN_METERS = 10;
/** geo.ts ile ayni yaricap (Mongo'nun kure hesabi da 6378,1 km). */
const EARTH_RADIUS_METERS = 6_378_100;

let container: StartedMongoDBContainer;
const connections: MongoConnection[] = [];
let couriers: CouriersCollection;
let writer: MongoCourierSeedWriter;
/** Ayni veritabanina bakan iki courier kopyasi. */
let replicas: [QaCourierServer, QaCourierServer];
const clock: MutableClock = fixedClock(NOW_MS);

/** Istekleri iki kopyaya sirayla dagitir. */
function replicaFor(index: number): QaCourierServer {
  const replica = replicas[index % replicas.length];
  if (replica === undefined) throw new Error('kopya yok');
  return replica;
}

async function reset(list: readonly Courier[]): Promise<void> {
  await writer.replaceAll(list, MARKET_LOCATION_SEEDS);
}

async function openReplica(name: string): Promise<QaCourierServer> {
  const connection = await connectMongo({
    uri: `${container.getConnectionString()}/?directConnection=true`,
    dbName: DB_NAME,
    operationTimeoutMs: STORE_TIMEOUT_MS,
  });
  connections.push(connection);
  const store = new CourierMongoStore(
    new CouriersCollection(connection.db),
    new MarketsCollection(connection.db),
  );
  return startQaCourierServer({ repository: store, markets: store, clock, name });
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  const first = await openReplica('courier-qa-havuz-1');
  const second = await openReplica('courier-qa-havuz-2');
  replicas = [first, second];
  const [connection] = connections;
  if (connection === undefined) throw new Error('baglanti yok');
  couriers = new CouriersCollection(connection.db);
  await couriers.ensureIndexes();
  writer = new MongoCourierSeedWriter(connection, couriers, new MarketsCollection(connection.db));
});

afterAll(async () => {
  await Promise.all((replicas ?? []).map((replica) => replica.stop()));
  for (const connection of connections) {
    await connection.close();
  }
  await container?.stop();
});

/** `from`'dan `bearingDegrees` yonunde `meters` uzaklikta nokta (buyuk daire). */
function destination(from: GeoPoint, bearingDegrees: number, meters: number): GeoPoint {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const toDegrees = (radians: number): number => (radians * 180) / Math.PI;
  const angular = meters / EARTH_RADIUS_METERS;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(from.lat);
  const lng1 = toRadians(from.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDegrees(lat2), lng: toDegrees(lng2) };
}

describe('QA T13.2 yogunluk (O1 kalici), iki courier kopyasi', () => {
  it.each([
    [60, 40],
    [30, 40],
  ])(
    '%i bos kurye ayni noktada, %i siparis iki kopyaya ayni anda (3 tur): bos kurye varken NOT_FOUND yok, kurye basina tek siparis',
    async (available, orders) => {
      const expected = Math.min(available, orders);
      for (let round = 0; round < 3; round += 1) {
        await reset(Array.from({ length: available }, (_, index) => courier(index + 1)));
        const ids = Array.from({ length: orders }, () => orderId());

        const outcomes = (
          await Promise.all(ids.map((order, index) => replicaFor(index).assign(order, MARKET)))
        ).map((result) => outcomeOf(result));

        const won = outcomes.flatMap((outcome) => (outcome.kind === 'atandi' ? [outcome] : []));
        const lost = outcomes.filter((outcome) => outcome.kind === 'hata');
        expect(won, `tur ${round}`).toHaveLength(expected);
        expect(lost.map((outcome) => (outcome.kind === 'hata' ? outcome.grpc : -1))).toEqual(
          Array.from({ length: orders - expected }, () => GRPC_STATUS.NOT_FOUND),
        );
        expect(new Set(won.map((outcome) => outcome.courierId)).size).toBe(expected);
        outcomes.forEach((outcome, index) => {
          if (outcome.kind === 'atandi') expect(outcome.orderId).toBe(ids[index]);
        });
        expect(await couriers.count({ status: COURIER_STATUS.BUSY })).toBe(expected);
        expect(await couriers.count({ status: COURIER_STATUS.IDLE })).toBe(available - expected);
      }
    },
  );
});

describe('QA T13.2 sinirlar yone bagli degil; bellek ile Mongo ayni', () => {
  const bearings = [
    ['kuzey', 0],
    ['dogu', 90],
    ['guney', 180],
    ['bati', 270],
    ['kuzeydogu', 45],
    ['guneybati', 225],
  ] as const;

  /**
   * Bir yonde dort kurye: dilim sinirinin 10 m oncesinde (yeni bosalmis) ve sonrasinda
   * (uzun suredir bos); havuz sinirinin 10 m icinde ve disinda. Uc siparis sirayla.
   */
  function edgeCouriers(bearing: number): Courier[] {
    const band = COURIER_PROXIMITY_BAND_METERS;
    const radius = COURIER_POOL_RADIUS_METERS;
    const at = (minute: number): Date => new Date(NOW_MS + minute * 60_000);
    return [
      courier(1, {
        lastLocation: destination(MARKET_LOCATION, bearing, band - EDGE_MARGIN_METERS),
        idleSince: at(30),
      }),
      courier(2, {
        lastLocation: destination(MARKET_LOCATION, bearing, band + EDGE_MARGIN_METERS),
        idleSince: at(0),
      }),
      courier(3, {
        lastLocation: destination(MARKET_LOCATION, bearing, radius - EDGE_MARGIN_METERS),
      }),
      courier(4, {
        lastLocation: destination(MARKET_LOCATION, bearing, radius + EDGE_MARGIN_METERS),
      }),
    ];
  }

  /** Dort siparisin sonucu: atanan kurye ya da NOT_FOUND; dordunden sonra disaridaki kuryenin durumu. */
  async function picks(server: QaCourierServer): Promise<string[]> {
    const result: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const outcome = outcomeOf(await server.assign(orderId(), MARKET));
      result.push(outcome.kind === 'atandi' ? outcome.courierId : `hata ${outcome.grpc}`);
    }
    const outside = await server.get(courierId(4));
    result.push(
      outside.response?.courier?.status === courierV1.CourierStatus.COURIER_STATUS_IDLE
        ? 'disaridaki bos'
        : 'disaridaki ATANDI',
    );
    return result;
  }

  it.each(bearings)(
    '%s: dilim siniri yakin olani once secer (bekleme suresine ragmen), 3 km icindeki alinir, disindaki hic alinmaz; bellek ve Mongo ayni',
    async (_name, bearing) => {
      const expected = [
        courierId(1),
        courierId(2),
        courierId(3),
        `hata ${GRPC_STATUS.NOT_FOUND}`,
        'disaridaki bos',
      ];
      const memory = await startQaCourierServer({
        repository: new InMemoryCourierStore(edgeCouriers(bearing), MARKET_LOCATION_SEEDS),
        clock,
        name: 'courier-qa-bellek',
      });
      try {
        await reset(edgeCouriers(bearing));
        const [mongo] = replicas;

        const fromMemory = await picks(memory);
        const fromMongo = await picks(mongo);

        expect(fromMemory).toEqual(expected);
        expect(fromMongo).toEqual(fromMemory);
      } finally {
        await memory.stop();
      }
    },
  );
});

describe('QA T13.2 adil sira uzun kosuda (#88), Mongo', () => {
  it('ayni dilimde 4 kurye, 24 ata-birak dongusu: sirayla doner; ust dilimdeki kurye alt dilim bosken hic secilmez, dolunca secilir', async () => {
    const near = [50, 120, 200, 260];
    const band0 = near.map((meters, index) =>
      courier(index + 1, { lastLocation: destination(MARKET_LOCATION, index * 90, meters) }),
    );
    // Ust dilimde (400 m), EN uzun suredir bosta: yine de alt dilim once.
    const upper = courier(9, {
      lastLocation: destination(MARKET_LOCATION, 45, 400),
      idleSince: new Date(NOW_MS - 3_600_000),
    });
    await reset([...band0, upper]);
    const [server] = replicas;
    const cycles = band0.length * 6;

    const picked: string[] = [];
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      clock.advance(1_000);
      const order = orderId();
      const outcome = outcomeOf(await server.assign(order, MARKET));
      picked.push(outcome.kind === 'atandi' ? outcome.courierId : 'yok');
      clock.advance(1_000);
      expect((await server.release(order)).response?.released).toBe(true);
    }
    // Alt dilimin dort kuryesini de meshgul et: siradaki siparis ust dilime duser.
    const held: string[] = [];
    for (let index = 0; index < band0.length; index += 1) {
      clock.advance(1_000);
      const outcome = outcomeOf(await server.assign(orderId(), MARKET));
      held.push(outcome.kind === 'atandi' ? outcome.courierId : 'yok');
    }
    const overflow = outcomeOf(await server.assign(orderId(), MARKET));

    const firstRound = band0.map((one) => one.id);
    expect(picked).toEqual(
      Array.from({ length: cycles }, (_, index) => firstRound[index % firstRound.length]),
    );
    expect(picked).not.toContain(upper.id);
    expect(held.sort()).toEqual([...firstRound].sort());
    expect(overflow.kind === 'atandi' ? overflow.courierId : 'yok').toBe(upper.id);
  });
});
