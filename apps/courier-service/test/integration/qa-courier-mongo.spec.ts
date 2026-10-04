/**
 * QA kara kutu (T13.1; havuz T13.2), gercek Mongo (Testcontainers): atamanin
 * gercek sorgularla ve servisin iki kopyasiyla davranisi. Istemci gercek gRPC;
 * depo durumu yalnizca dogrulama icin ayri baglantidan okunur.
 *
 *   1. B1 karisik yaris: tek bos kurye, ayni siparisin tekrarlari rakip siparislerle
 *      ayni anda ve iki kopyaya dagitilmis; her siparisin butun cevaplari tutarli.
 *   2. Cok kurye, cok siparis, iki kopya: kurye ikiye bolunmez, semt havuzlari karismaz.
 *   3. Tekrar istek secim denemez: TEL UZERINDE (komut izleme) couriers'a yazim gitmez.
 *   4. Servisin GERCEKTEN gonderdigi sorgular indeksten okunur (COLLSCAN, bellek ici SORT yok).
 *   5. Cevabi kaybolan atama (#51): yazim Mongo'da uygulanir ama istemci SERVICE_UNAVAILABLE
 *      alir; order'in tekrar istegi AYNI kuryeyi alir, ikinci kurye baglanmaz.
 *
 * Backend testlerinde olanlar (tek kurye + 20 siparis, ayni siparis 10 kez, indeks
 * tanimlari, $geoNear plani, acilis, goc ve seed use-case'i) yinelenmez.
 */

import { performance } from 'node:perf_hooks';

import { ERROR_CODES, fixedClock, GRPC_STATUS } from '@getir/core';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { appErrorOf } from '@getir/service-kit/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import type { CommandStartedEvent, Document } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { FreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Courier } from '../../src/domain/courier.js';
import { courierFromSeed } from '../../src/domain/courier-seed.js';
import {
  COURIER_SEEDS,
  MARKET_LOCATION_SEEDS,
} from '../../src/infrastructure/fixtures/couriers.js';
import { CourierMongoStore } from '../../src/infrastructure/mongo/courier-mongo-store.js';
import { CouriersCollection } from '../../src/infrastructure/mongo/couriers-collection.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { MarketsCollection } from '../../src/infrastructure/mongo/markets-collection.js';
import { MongoCourierSeedWriter } from '../../src/infrastructure/mongo/mongo-courier-seed-writer.js';
import {
  courier,
  FAR_MARKET,
  FAR_MARKET_LOCATION,
  MARKET,
  MARKET_LOCATION,
  NOW_MS,
  orderId,
} from '../support/couriers.js';
import { outcomeOf, startQaCourierServer } from '../support/qa-courier-harness.js';
import type { QaCourierServer, QaOutcome } from '../support/qa-courier-harness.js';

const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_courier_qa';
const MONGO_PORT = 27_017;
/**
 * Islem suresi: uretimdeki gibi SURELI baglanti (#51 surucu yollari), ama yuklu
 * makinede (CI'da 2 cekirdek) yaris testleri yanlis kirmizi vermesin diye genis.
 * Surenin kendisi asagida FROZEN_TIMEOUT_MS ile olculur.
 */
const OPERATION_TIMEOUT_MS = 10_000;
/** Donmus Mongo testinin islem suresi: kisa, olcum payi genis. */
const FROZEN_TIMEOUT_MS = 500;
const SLACK_MS = 1_500;

/** B1 karisik yaris: tur sayisi ve tur basina istekler. */
const B1_ROUNDS = 25;
const SAME_ORDER_REPEATS = 6;
const RIVAL_REPEATS = 3;

/** MARKET'le ayni semtte (Kadikoy, ~620 m): ayni havuzu paylasir. */
const THIRD_MARKET = 'mkt_kardesler-manavi';

let container: StartedMongoDBContainer;
let connection: MongoConnection;
let second: MongoConnection;
let couriers: CouriersCollection;
let writer: MongoCourierSeedWriter;
/** Servisin iki kopyasi: ayni Mongo, ayri baglanti havuzlari. */
let replicas: [QaCourierServer, QaCourierServer];

const clock = fixedClock(NOW_MS);

function directUri(): string {
  return `${container.getConnectionString()}/?directConnection=true`;
}

/** Kuryeleri bastan yazar; market kopyasi her seferinde 21 demo marketi. */
async function reset(list: readonly Courier[]): Promise<void> {
  await writer.replaceAll(list, MARKET_LOCATION_SEEDS);
}

/** Bir veritabanina bakan depo: kuryeler ve market kopyasi ayni yerden. */
function mongoStore(db: MongoConnection['db']): CourierMongoStore {
  return new CourierMongoStore(new CouriersCollection(db), new MarketsCollection(db));
}

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await connectMongo({
    uri: directUri(),
    dbName: DB_NAME,
    operationTimeoutMs: OPERATION_TIMEOUT_MS,
  });
  second = await connectMongo({
    uri: directUri(),
    dbName: DB_NAME,
    operationTimeoutMs: OPERATION_TIMEOUT_MS,
  });
  couriers = new CouriersCollection(connection.db);
  await couriers.ensureIndexes();
  writer = new MongoCourierSeedWriter(connection, couriers, new MarketsCollection(connection.db));
  const first = mongoStore(connection.db);
  const other = mongoStore(second.db);
  replicas = [
    await startQaCourierServer({
      repository: first,
      markets: first,
      clock,
      name: 'courier-qa-1',
    }),
    await startQaCourierServer({
      repository: other,
      markets: other,
      clock,
      name: 'courier-qa-2',
    }),
  ];
});

afterAll(async () => {
  await Promise.all((replicas ?? []).map((replica) => replica.stop()));
  await second?.close();
  await connection?.close();
  await container?.stop();
});

/** Istek plani: siparis ve kac kez istenecegi. Istekler siparisler arasinda donusumlu dizilir. */
function interleave(plan: readonly { readonly order: string; readonly times: number }[]): string[] {
  const longest = Math.max(...plan.map(({ times }) => times));
  const calls: string[] = [];
  for (let round = 0; round < longest; round += 1) {
    for (const { order, times } of plan) {
      if (round < times) calls.push(order);
    }
  }
  return calls;
}

interface Observed {
  readonly order: string;
  readonly outcome: QaOutcome;
}

/** Istekleri AYNI ANDA, iki kopyaya sirayla dagitarak gonderir. */
async function fire(calls: readonly string[], market: string): Promise<Observed[]> {
  const replicaFor = (index: number): QaCourierServer => {
    const replica = replicas[index % replicas.length];
    if (replica === undefined) throw new Error('kopya yok');
    return replica;
  };
  const results = await Promise.all(
    calls.map((order, index) => replicaFor(index).assign(order, market)),
  );
  return calls.map((order, index) => {
    const result = results[index];
    if (result === undefined) throw new Error('cevap yok');
    return { order, outcome: outcomeOf(result) };
  });
}

/**
 * Siparis basina tutarlilik: bir siparisin BUTUN cevaplari ayni (hepsi ayni kurye
 * ya da hepsi NOT_FOUND); atanan kurye o siparise bagli; iki siparis ayni kuryeyi
 * almaz; NOT_FOUND disinda hata yok. Kazanan siparis -> kurye esleme doner.
 */
function expectConsistent(observed: readonly Observed[]): Map<string, string> {
  const byOrder = new Map<string, Set<string>>();
  for (const { order, outcome } of observed) {
    if (outcome.kind === 'hata') {
      expect(outcome, `beklenmeyen hata (${order})`).toEqual({
        kind: 'hata',
        grpc: GRPC_STATUS.NOT_FOUND,
        code: ERROR_CODES.NOT_FOUND,
      });
    } else {
      expect(outcome.orderId, 'kurye baska siparise bagli').toBe(order);
    }
    const seen = byOrder.get(order) ?? new Set<string>();
    seen.add(outcome.kind === 'atandi' ? outcome.courierId : 'NOT_FOUND');
    byOrder.set(order, seen);
  }
  const winners = new Map<string, string>();
  for (const [order, seen] of byOrder) {
    expect([...seen], `siparis ${order} karisik cevap aldi`).toHaveLength(1);
    const [only] = [...seen];
    if (only !== undefined && only !== 'NOT_FOUND') winners.set(order, only);
  }
  expect(new Set(winners.values()).size, 'bir kurye iki siparise verildi').toBe(winners.size);
  return winners;
}

describe('QA B1 karisik yaris (gercek Mongo, iki kopya)', () => {
  it(`tek bos kurye; ayni siparis ${SAME_ORDER_REPEATS} kez + iki rakip ${RIVAL_REPEATS}'er kez, ${B1_ROUNDS} tur: her siparisin cevabi tutarli, tek kazanan`, async () => {
    const wonBy = { same: 0, rival: 0 };
    for (let round = 0; round < B1_ROUNDS; round += 1) {
      await reset([courier(1)]);
      const same = orderId();
      const rivals = [orderId(), orderId()];
      const calls = interleave([
        { order: same, times: SAME_ORDER_REPEATS },
        ...rivals.map((order) => ({ order, times: RIVAL_REPEATS })),
      ]);

      const winners = expectConsistent(await fire(calls, MARKET));

      expect(winners.size, `tur ${round}`).toBe(1);
      const [[winner, courierId] = ['', '']] = [...winners];
      expect(courierId).toBe(courier(1).id);
      const holder = await couriers.findById(courier(1).id);
      expect(holder).toMatchObject({ status: COURIER_STATUS.BUSY, currentOrderId: winner });
      if (winner === same) wonBy.same += 1;
      else wonBy.rival += 1;
    }
    expect(wonBy.same + wonBy.rival).toBe(B1_ROUNDS);
  });

  it('iki semt x uc kurye; Kadikoy un iki marketine ve Besiktas a 5 siparis x 3 tekrar ayni anda: semt basina 3 atama, kurye bolunmez, semtler karismaz', async () => {
    const districts = [
      { name: 'Kadikoy', markets: [MARKET, THIRD_MARKET], location: MARKET_LOCATION, base: 0 },
      { name: 'Besiktas', markets: [FAR_MARKET], location: FAR_MARKET_LOCATION, base: 10 },
    ];
    await reset(
      districts.flatMap(({ location, base }) =>
        [1, 2, 3].map((n) => courier(base + n, { lastLocation: location })),
      ),
    );
    const ordersPerMarket = 5;
    const repeats = 3;

    const observed = await Promise.all(
      districts.map(async (district) => {
        const lists = await Promise.all(
          district.markets.map((marketId) =>
            fire(
              interleave(
                Array.from({ length: ordersPerMarket }, () => ({
                  order: orderId(),
                  times: repeats,
                })),
              ),
              marketId,
            ),
          ),
        );
        return { district, list: lists.flat() };
      }),
    );

    let busy = 0;
    for (const { district, list } of observed) {
      const winners = expectConsistent(list);
      expect(winners.size, district.name).toBe(3);
      for (const [order, courierId] of winners) {
        const held = await couriers.findById(courierId);
        expect(held, district.name).toMatchObject({
          status: COURIER_STATUS.BUSY,
          currentOrderId: order,
          lastLocation: {
            type: 'Point',
            coordinates: [district.location.lng, district.location.lat],
          },
        });
        busy += 1;
      }
    }
    expect(busy).toBe(6);
    expect(await couriers.count({ status: COURIER_STATUS.BUSY })).toBe(6);
  });
});

describe('QA tekrar istek tel uzerinde (komut izleme)', () => {
  let monitored: MongoClient;
  let server: QaCourierServer;
  const commands: CommandStartedEvent[] = [];
  const record = (event: CommandStartedEvent): void => {
    if (event.command[event.commandName] === COLLECTIONS.COURIERS) commands.push(event);
  };

  beforeAll(async () => {
    monitored = await MongoClient.connect(directUri(), { monitorCommands: true });
    monitored.on('commandStarted', record);
    const db = monitored.db(DB_NAME, { timeoutMS: OPERATION_TIMEOUT_MS });
    const store = mongoStore(db);
    server = await startQaCourierServer({
      repository: store,
      markets: store,
      clock,
      name: 'courier-qa-izlenen',
    });
  });

  afterAll(async () => {
    await server?.stop();
    monitored?.off('commandStarted', record);
    await monitored?.close();
  });

  afterEach(() => {
    commands.length = 0;
  });

  const names = () => commands.map((event) => event.commandName);

  it('ilk atama yazar (olumlu kontrol); tekrarlar yalnizca okur, son atama ani degismez; havuz dolunca da ayni kurye', async () => {
    await reset([courier(1), courier(2)]);
    const order = orderId();

    const first = await server.assign(order, MARKET);
    expect(names()).toContain('findAndModify'); // izleme gercekten yazimi goruyor
    const assignedAt = (await couriers.findById(first.response?.courier?.id ?? ''))?.lastAssignedAt;
    commands.length = 0;

    clock.advance(60_000);
    const sequential = [await server.assign(order, MARKET), await server.assign(order, MARKET)];
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => server.assign(order, MARKET)),
    );
    const retryCommands = names();
    commands.length = 0;

    await server.assign(orderId(), MARKET); // rakip siparis: havuz doldu
    expect(names()).toContain('findAndModify');
    commands.length = 0;
    const whenFull = await server.assign(order, MARKET);

    expect(retryCommands.length).toBeGreaterThan(0);
    expect(new Set(retryCommands)).toEqual(new Set(['find']));
    expect(names()).toEqual(['find']);
    for (const retry of [...sequential, ...concurrent, whenFull]) {
      expect(retry.response).toEqual(first.response);
    }
    expect((await couriers.findById(first.response?.courier?.id ?? ''))?.lastAssignedAt).toEqual(
      assignedAt,
    );
  });

  it('servisin gonderdigi atama, siparis okuma ve birakma sorgulari indeksten okur (COLLSCAN ve bellek ici SORT yok)', async () => {
    await reset(COURIER_SEEDS.map((seed) => courierFromSeed(seed, new Date(NOW_MS))));
    const order = orderId();

    await server.assign(order, MARKET);
    await server.release(order);
    const sent = commands.map((event) => event.command);
    commands.length = 0;

    const explained = await Promise.all(sent.map((command) => explainAsSent(command)));

    expect(explained.map(({ kind }) => kind).sort()).toEqual([
      'aggregate:havuz', // marketin cevresindeki adaylar ($geoNear)
      'find', // siparisin kuryesi var mi (findByOrder)
      'findAndModify:atama', // aday hala IDLE ise al (kimlikle)
      'findAndModify:birakma',
    ]);
    for (const { kind, plan } of explained) {
      expect(plan, kind).not.toContain('COLLSCAN');
      if (kind !== 'aggregate:havuz') {
        expect(plan, kind).not.toContain('"SORT"');
      }
    }
    const byKind = new Map(explained.map(({ kind, plan }) => [kind, plan]));
    expect(byKind.get('aggregate:havuz')).toContain('GEO_NEAR_2DSPHERE');
    expect(byKind.get('aggregate:havuz')).toContain('lastLocation_2dsphere_status');
    expect(byKind.get('findAndModify:atama')).toMatch(/IDHACK|"_id_"/);
    expect(byKind.get('find')).toContain('currentOrderId_unique');
    expect(byKind.get('findAndModify:birakma')).toContain('currentOrderId_unique');
  });
});

/** Servisin gonderdigi komutun alanlari (izlenen komut dis veridir: semadan gecer). */
const sentCommandSchema = z
  .object({
    find: z.string().optional(),
    findAndModify: z.string().optional(),
    aggregate: z.string().optional(),
    pipeline: z.array(z.record(z.unknown())).optional(),
    filter: z.record(z.unknown()).optional(),
    query: z.record(z.unknown()).optional(),
    // Surucu siralamayi alan sirasi korunsun diye Map olarak gonderir; oldugu gibi geri verilir.
    sort: z.unknown().optional(),
    update: z.record(z.unknown()).optional(),
    limit: z.number().optional(),
  })
  .passthrough();

const explainSchema = z
  .object({ queryPlanner: z.object({ winningPlan: z.unknown() }) })
  .passthrough();

/** Komutu oldugu gibi (oturum alanlari olmadan) explain eder; plani metin olarak doner. */
async function explainAsSent(raw: Document): Promise<{ kind: string; plan: string }> {
  const command = sentCommandSchema.parse(raw);
  const db = connection.client.db(DB_NAME);
  if (command.aggregate !== undefined) {
    // Toplama hattinin explain'i ayri bicimde (asamalar); plan metnin icinde aranir.
    const result: unknown = await db.command({
      explain: { aggregate: command.aggregate, pipeline: command.pipeline, cursor: {} },
      verbosity: 'queryPlanner',
    });
    return { kind: 'aggregate:havuz', plan: JSON.stringify(result) };
  }
  if (command.find !== undefined) {
    const result = explainSchema.parse(
      await db.command({
        explain: { find: command.find, filter: command.filter, limit: command.limit },
        verbosity: 'queryPlanner',
      }),
    );
    return { kind: 'find', plan: JSON.stringify(result.queryPlanner.winningPlan) };
  }
  const result = explainSchema.parse(
    await db.command({
      explain: {
        findAndModify: command.findAndModify,
        query: command.query,
        ...(command.sort === undefined ? {} : { sort: command.sort }),
        update: command.update,
      },
      verbosity: 'queryPlanner',
    }),
  );
  const kind =
    command.query?.status === undefined ? 'findAndModify:birakma' : 'findAndModify:atama';
  return { kind, plan: JSON.stringify(result.queryPlanner.winningPlan) };
}

describe('QA cevabi kaybolan atama ve donmus Mongo (#51)', () => {
  let proxy: FreezingProxy;
  let client: MongoClient;
  let server: QaCourierServer;
  /** true iken servisin ilk findAndModify'i yola cikar cikmaz vekil donar. */
  let freezeOnWrite = false;
  const onCommand = (event: CommandStartedEvent): void => {
    if (freezeOnWrite && event.commandName === 'findAndModify') {
      freezeOnWrite = false;
      proxy.freeze();
    }
  };

  beforeAll(async () => {
    proxy = await startFreezingProxy({
      host: container.getHost(),
      port: container.getMappedPort(MONGO_PORT),
    });
    client = await MongoClient.connect(`mongodb://127.0.0.1:${proxy.port}/?directConnection=true`, {
      monitorCommands: true,
    });
    client.on('commandStarted', onCommand);
    const store = mongoStore(client.db(DB_NAME, { timeoutMS: FROZEN_TIMEOUT_MS }));
    server = await startQaCourierServer({
      repository: store,
      markets: store,
      clock,
      name: 'courier-qa-vekil',
    });
  });

  afterEach(async () => {
    freezeOnWrite = false;
    proxy.thaw();
    // Donukken kapanan baglantilarin yerine yenileri kurulsun.
    await expect(
      waitFor(async () => (await server.get(courier(1).id)).error === undefined),
    ).resolves.toBe(true);
  });

  afterAll(async () => {
    proxy?.thaw();
    await server?.stop();
    client?.off('commandStarted', onCommand);
    await client?.close();
    await proxy?.close();
  });

  it('atama yazimi Mongo ya ulasabilir ama cevap gelmez: SERVICE_UNAVAILABLE; tekrar istek ulasan yazimin kuryesini alir, ikinci kurye baglanmaz', async () => {
    await reset([courier(1), courier(2)]);
    await server.get(courier(1).id); // baglanti isinsin: donma yazimin kendisinde olsun
    const order = orderId();

    freezeOnWrite = true;
    const started = performance.now();
    const lost = await server.assign(order, MARKET);
    const elapsed = performance.now() - started;
    proxy.thaw();
    // Zaman asimi ne "yazilmadi" ne "yazildi" demektir (#51): istemci baglantiyi
    // nasil kapattiysa vekil bekleyen yazimi iletir ya da birakir. Iki kol da gecerli.
    await waitFor(async () => (await couriers.findByOrder(order)) !== null, 1_000);
    const holder = await couriers.findByOrder(order);
    await waitFor(async () => (await server.get(courier(1).id)).error === undefined);
    const retry = await server.assign(order, MARKET);

    expect(lost.error?.code).toBe(GRPC_STATUS.UNAVAILABLE);
    expect(appErrorOf(lost.error)?.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(elapsed).toBeLessThan(FROZEN_TIMEOUT_MS + SLACK_MS);
    expect(retry.error).toBeUndefined();
    // Yazim ulastiysa tekrar istek AYNI kuryeyi alir; ulasmadiysa yeni atama olur.
    expect(retry.response?.courier?.id).toBe(holder?._id ?? retry.response?.courier?.id);
    // Her iki kolda: courier tarafinda siparisi tasiyan kurye cevaptaki kurye.
    expect((await couriers.findByOrder(order))?._id).toBe(retry.response?.courier?.id);
    expect(await couriers.count({ status: COURIER_STATUS.BUSY })).toBe(1);
  });

  it('Mongo donukken uc RPC de surede UNAVAILABLE doner (order asili kalmaz); cozulunce atama calisir', async () => {
    await reset([courier(1)]);
    await server.get(courier(1).id);
    const order = orderId();

    proxy.freeze();
    const started = performance.now();
    const frozen = [
      (await server.assign(order, MARKET)).error,
      (await server.get(courier(1).id)).error,
      (await server.release(order)).error,
    ];
    const elapsed = performance.now() - started;
    proxy.thaw();
    await waitFor(async () => (await server.get(courier(1).id)).error === undefined);
    const after = await server.assign(order, MARKET);

    expect(frozen.map((error) => error?.code)).toEqual(Array(3).fill(GRPC_STATUS.UNAVAILABLE));
    expect(frozen.map((error) => appErrorOf(error)?.code)).toEqual(
      Array(3).fill(ERROR_CODES.SERVICE_UNAVAILABLE),
    );
    expect(elapsed).toBeLessThan(3 * FROZEN_TIMEOUT_MS + SLACK_MS);
    expect(after.response?.courier?.id).toBe(courier(1).id);
    expect(await couriers.count({ status: COURIER_STATUS.BUSY })).toBe(1);
  });
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}
