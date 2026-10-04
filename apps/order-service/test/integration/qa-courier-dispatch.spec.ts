/**
 * QA kara kutu (T13.1 PR 2), gercek Mongo (Testcontainers): order'in kurye iscisi
 * GERCEK courier-svc'ye gercek gRPC ile baglanir; iki servis ayri veritabaninda
 * (D14), courier'in deposu da Mongo. Backend testlerinde courier sahtedir.
 *
 * Courier'in durumu courier'in kendi RPC'siyle (GetCourier), order'inki deposundan
 * okunur; "capraz tutarlilik" ikisinin ayni seyi soylemesidir (crossCheck).
 *
 *   1. "Bitti sayilir" uctan uca: kurye iki tarafta da ayni; tek olay; ayni istek kimligi.
 *   2. Kurye yok: kuryesiz PREPARING bekler; kurye bosalinca en gec deneme aninda alir.
 *   4. Iki order + iki courier kopyasi ayni anda: kurye bolunmez, iki taraf tutarli.
 *   5. QA T3, gercek courier: atama ucustayken siparis kapanir; kurye GERI verilir.
 *   6. Bilinen sinir (README): telafinin birakmasi da duserse kurye BUSY kalir.
 *   7. Cevabi kaybolan atama: courier bagladi, cevap order'a yetismedi; sonraki tur AYNI kurye.
 *   8. Order'in Mongo'su yazimda donar: kurye birakilmaz, toparlaninca ayni kurye.
 *   9. courier coker ve ayni adreste geri gelir: siparisler bekler, sonra atanir.
 *  13. Iscinin GONDERDIGI kuyruk sorgusu (profiler): kismi indeksten, bellekte siralama yok.
 *
 * Gunluk metni ve sira (#92 FIFO, D1-D3) sonraki order PR'inda degisecek: burada
 * yalnizca davranis (cift atama yok, toparlanma var, tutarlilik) dogrulanir.
 */

import { fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { connectMongo } from '@getir/mongo-kit';
import type { MongoConnection } from '@getir/mongo-kit';
import { courierV1 } from '@getir/proto';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { Courier } from '../../../courier-service/src/domain/courier.js';
import { CourierMongoStore } from '../../../courier-service/src/infrastructure/mongo/courier-mongo-store.js';
import { MARKET_LOCATION_SEEDS } from '../../../courier-service/src/infrastructure/fixtures/couriers.js';
import { CouriersCollection } from '../../../courier-service/src/infrastructure/mongo/couriers-collection.js';
import { MarketsCollection } from '../../../courier-service/src/infrastructure/mongo/markets-collection.js';
import { MongoCourierSeedWriter } from '../../../courier-service/src/infrastructure/mongo/mongo-courier-seed-writer.js';
import { COURIER_RETRY_DELAY_MS, DEPENDENCY_BREAKER_OPEN_MS } from '../../src/config/constants.js';
import { statusChangedEvents } from '../../src/domain/order-events.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import type { OrderDocument } from '../../src/infrastructure/mongo/documents.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';
import type { OrderStore } from '../../src/infrastructure/order-store.js';
import {
  crossCheck,
  freeFixedPort,
  gate,
  HookedCourierRepository,
  isBusy,
  orderSide,
  placeCouriers,
  QA_NOW_MS,
  startCourierService,
  storeUnavailable,
  waitFor,
} from '../support/qa-courier-world.js';
import type { QaCourierService, QaOrderSide } from '../support/qa-courier-world.js';

const MONGO_IMAGE = 'mongo:7';
const MONGO_PORT = 27_017;
/**
 * Sureli baglanti (#51 surucu yollari) ama yuklu makinede yanlis kirmizi vermesin
 * diye genis; donma testinde kisa (FROZEN_TIMEOUT_MS).
 */
const STORE_TIMEOUT_MS = 10_000;
const FROZEN_TIMEOUT_MS = 500;

let container: StartedMongoDBContainer;
/** Servislerin disindan okuma (outbox, profiler). */
let raw: MongoClient;
let dbCounter = 0;
const cleanups: (() => Promise<void> | void)[] = [];

function directUri(): string {
  return `${container.getConnectionString()}/?directConnection=true`;
}

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

/** Her test kendi iki veritabaninda (D14: servis basina veritabani). */
function freshDbs(): { readonly order: string; readonly courier: string } {
  dbCounter += 1;
  return { order: `qa_order_${dbCounter}`, courier: `qa_courier_${dbCounter}` };
}

interface CourierSide {
  readonly service: QaCourierService;
  readonly hooks: HookedCourierRepository;
  readonly connection: MongoConnection;
}

/** courier-svc: kendi Mongo veritabani, kuryeler seed yazicisiyla, gercek gRPC sunucusu. */
async function courierOnMongo(options: {
  readonly dbName: string;
  readonly placed?: readonly Courier[];
  readonly clock: MutableClock;
  readonly lines?: LogLine[];
  readonly port?: number;
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
async function orderOnMongo(options: {
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
function preparingEvents(dbName: string, orderId: string): Promise<number> {
  return raw.db(dbName).collection(COLLECTIONS.OUTBOX).countDocuments({
    aggregateId: orderId,
    topic: 'order.status_changed',
    'payload.from': ORDER_STATUS.PAID,
    'payload.to': ORDER_STATUS.PREPARING,
  });
}

async function ordersOf(side: QaOrderSide, ids: readonly string[]): Promise<Order[]> {
  const found = await Promise.all(ids.map((id) => side.order(id)));
  return found.flatMap((order) => (order === null ? [] : [order]));
}

async function busyOf(service: QaCourierService, placed: readonly Courier[]) {
  const states = await Promise.all(placed.map((courier) => service.get(courier.id)));
  return states.filter(isBusy);
}

/** Iptal yolu (bugun kod yolu yok; durum tablosunda PAID -> CANCELLED var): siparisi kapatir. */
async function cancelOrder(side: QaOrderSide, orderId: string): Promise<void> {
  const current = await side.order(orderId);
  if (current === null) throw new Error(`siparis yok: ${orderId}`);
  const cancelled = transitionOrder(current, ORDER_STATUS.CANCELLED, side.clock);
  await side.store.repository.update(
    cancelled,
    current.version,
    statusChangedEvents(current, cancelled),
  );
}

describe('QA T13.1 PR 2 uctan uca (gercek courier, gercek Mongo)', () => {
  it('1. odenen siparis kuryeyle PREPARING; courier ayni kuryeyi BUSY tutar; tek olay; ayni istek kimligi', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const courierLines: LogLine[] = [];
    const orderLines: LogLine[] = [];
    const placed = placeCouriers(2);
    const courier = await courierOnMongo({
      dbName: dbs.courier,
      placed,
      clock,
      lines: courierLines,
    });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
      lines: orderLines,
    });
    const order = await side.paid();

    await side.tour();
    const written = await side.order(order.id);

    expect(written?.status).toBe(ORDER_STATUS.PREPARING);
    expect(written?.courier).toBeDefined();
    expect(written?.courierRetryAt).toBeUndefined();
    expect(await crossCheck(courier.service, placed, written === null ? [] : [written])).toEqual(
      [],
    );
    expect(await busyOf(courier.service, placed)).toHaveLength(1);
    expect(await preparingEvents(dbs.order, order.id)).toBe(1);
    // D16: siparisin istegi courier'a ayni kimlikle gider.
    const orderRequestIds = new Set(
      orderLines
        .filter((line) => line.fields.orderId === order.id)
        .map((line) => line.fields.requestId),
    );
    const courierRequestIds = courierLines
      .filter((line) => line.fields.rpc === 'AssignCourier')
      .map((line) => line.fields.requestId);
    expect(courierRequestIds.length).toBeGreaterThan(0);
    expect(courierRequestIds.some((id) => orderRequestIds.has(id))).toBe(true);
  });

  it('2. bos kurye yok: kuryesiz PREPARING bekler (olay bir kez); kurye bosalinca en gec deneme aninda alir', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(1);
    const courier = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
    });
    const first = await side.paid();
    await side.tour();
    const waiting = await side.paid();

    await side.tour();
    const queued = await side.order(waiting.id);
    // Teslimat kapanisi gibi (T13.x): ilk siparisin kuryesi courier'da bosalir.
    const released = await courier.service.release(first.id);
    clock.advance(COURIER_RETRY_DELAY_MS);
    await side.tour();
    const assigned = await side.order(waiting.id);

    expect(queued).toMatchObject({ status: ORDER_STATUS.PREPARING });
    expect(queued?.courier).toBeUndefined();
    expect(released?.released).toBe(true);
    expect(assigned?.courier?.courierId).toBe(placed[0]?.id);
    expect(assigned?.courierRetryAt).toBeUndefined();
    expect(await crossCheck(courier.service, placed, assigned === null ? [] : [assigned])).toEqual(
      [],
    );
    expect(await preparingEvents(dbs.order, waiting.id)).toBe(1);
  });
});

describe('QA T13.1 PR 2 iki order + iki courier kopyasi (4)', () => {
  it('40 siparis, 5 kurye, turlar ayni anda: tek kurye tek siparis, iki taraf tutarli, siparis basina tek olay; bosalan kuryeler de tutarli dagilir', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(5);
    const courierA = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const courierB = await courierOnMongo({ dbName: dbs.courier, clock });
    const sideA = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courierA.service.address,
      clock,
    });
    const sideB = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courierB.service.address,
      clock,
    });
    const ids: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      ids.push((await sideA.paid()).id);
    }

    for (let round = 0; round < 4; round += 1) {
      await Promise.all([sideA.tour(), sideB.tour()]);
    }
    const settled = await ordersOf(sideA, ids);
    const withCourier = settled.filter((order) => order.courier !== undefined);

    expect(withCourier).toHaveLength(5);
    expect(settled.every((order) => order.status === ORDER_STATUS.PREPARING)).toBe(true);
    expect(await crossCheck(courierA.service, placed, settled)).toEqual([]);
    for (const id of ids) {
      expect(await preparingEvents(dbs.order, id), id).toBe(1);
    }

    // Iki teslimat kapanir (T13.x): kuryeler bosalir, bekleyenler deneme aninda yarisir.
    const delivered = withCourier.slice(0, 2).map((order) => order.id);
    for (const id of delivered) {
      expect((await courierA.service.release(id))?.released).toBe(true);
    }
    clock.advance(COURIER_RETRY_DELAY_MS);
    for (let round = 0; round < 3; round += 1) {
      await Promise.all([sideA.tour(), sideB.tour()]);
    }
    const later = (await ordersOf(sideA, ids)).filter((order) => !delivered.includes(order.id));

    expect(later.filter((order) => order.courier !== undefined)).toHaveLength(5);
    expect(await crossCheck(courierB.service, placed, later)).toEqual([]);
    for (const id of ids) {
      expect(await preparingEvents(dbs.order, id), id).toBe(1);
    }
  });
});

describe('QA T13.1 PR 2 telafi (QA T3) gercek courier ile', () => {
  it('5. atama ucustayken siparis iptal; iptalin birakmasi bos doner; order yazamaz ve kuryeyi GERI verir', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(1);
    const courier = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
    });
    const victim = await side.paid();
    let earlyRelease: courierV1.ReleaseCourierResponse | undefined;
    courier.hooks.beforeClaim = async (request) => {
      if (request.orderId !== victim.id) return;
      courier.hooks.beforeClaim = undefined;
      await cancelOrder(side, victim.id);
      // Iptal yolunun birakmasi atamadan ONCE varir: tasiyan kurye henuz yok.
      earlyRelease = await courier.service.release(victim.id);
    };

    await side.tour();
    const after = await side.order(victim.id);
    const state = await courier.service.get(placed[0]?.id ?? '');
    const next = await side.paid();
    await side.tour();

    expect(earlyRelease).toEqual({ released: false, courierId: '' });
    expect(after?.status).toBe(ORDER_STATUS.CANCELLED);
    expect(after?.courier).toBeUndefined();
    expect(state?.status).toBe(courierV1.CourierStatus.COURIER_STATUS_IDLE);
    expect(state?.currentOrderId).toBe('');
    expect(await preparingEvents(dbs.order, victim.id)).toBe(0);
    // Geri verilen kurye yeniden kullanilir.
    expect((await side.order(next.id))?.courier?.courierId).toBe(placed[0]?.id);
  });

  it('6. BILINEN SINIR (order README): telafinin birakmasi da duserse kurye BUSY kalir; isci iptal edilmis siparisi bir daha gormez', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(1);
    const courier = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
    });
    const victim = await side.paid();
    courier.hooks.beforeClaim = async (request) => {
      if (request.orderId !== victim.id) return;
      courier.hooks.beforeClaim = undefined;
      await cancelOrder(side, victim.id);
      // Telafinin birakmasi geldiginde courier'in deposu yok.
      courier.hooks.releaseFailure = storeUnavailable();
    };

    await side.tour();
    courier.hooks.releaseFailure = undefined;
    for (let tour = 0; tour < 3; tour += 1) {
      await side.tour();
    }
    const state = await courier.service.get(placed[0]?.id ?? '');

    expect((await side.order(victim.id))?.status).toBe(ORDER_STATUS.CANCELLED);
    expect(isBusy(state)).toBe(true);
    expect(state?.currentOrderId).toBe(victim.id);
  });
});

describe('QA T13.1 PR 2 kaybolan cevap ve donmus Mongo', () => {
  it('7. courier kuryeyi bagladi ama cevap 1 sn suresini asti: siparis degismez; sonraki tur AYNI kuryeyi yazar, ikinci kurye yok', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(2);
    const courier = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
    });
    const order = await side.paid();
    // Kurye baglanir; cevap order'in 1 sn suresi dolana kadar donmez (kapi testte).
    const late = gate();
    let delayed = false;
    courier.hooks.afterClaim = async () => {
      if (delayed) return;
      delayed = true;
      await late.pass();
    };

    await side.tour();
    const lost = await side.order(order.id);
    late.open();
    const bound = await waitFor(async () => (await busyOf(courier.service, placed)).length === 1);
    const holder = (await busyOf(courier.service, placed))[0];
    await side.tour();
    const written = await side.order(order.id);

    expect(lost?.status).toBe(ORDER_STATUS.PAID);
    expect(bound).toBe(true);
    expect(holder?.currentOrderId).toBe(order.id);
    expect(written?.courier?.courierId).toBe(holder?.id);
    expect(await busyOf(courier.service, placed)).toHaveLength(1);
    expect(await preparingEvents(dbs.order, order.id)).toBe(1);
  });

  it('8. order in Mongo su atamanin yazimi sirasinda donar: kurye birakilmaz; cozulunce ayni kurye yazilir, tek olay', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(2);
    const proxy = await startFreezingProxy({
      host: container.getHost(),
      port: container.getMappedPort(MONGO_PORT),
    });
    cleanups.push(() => proxy.close());
    cleanups.push(() => proxy.thaw());
    const courier = await courierOnMongo({ dbName: dbs.courier, placed, clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
      uri: `mongodb://127.0.0.1:${proxy.port}/?directConnection=true`,
      operationTimeoutMs: FROZEN_TIMEOUT_MS,
    });
    const order = await side.paid();
    let frozen = false;
    // Kurye baglandi; order'in siradaki Mongo islemi atamanin yazimi: orada donar.
    courier.hooks.afterClaim = () => {
      if (!frozen) {
        frozen = true;
        proxy.freeze();
      }
      return Promise.resolve();
    };

    await side.tour();
    proxy.thaw();
    const holderAfterFreeze = (await busyOf(courier.service, placed))[0];
    const converged = await waitFor(async () => {
      await side.tour().catch(() => undefined);
      return (await side.order(order.id).catch(() => null))?.courier !== undefined;
    }, 10_000);
    const written = await side.order(order.id);

    expect(frozen).toBe(true);
    expect(holderAfterFreeze?.currentOrderId).toBe(order.id);
    expect(converged).toBe(true);
    expect(written?.courier?.courierId).toBe(holderAfterFreeze?.id);
    expect(await busyOf(courier.service, placed)).toHaveLength(1);
    expect(await preparingEvents(dbs.order, order.id)).toBe(1);
  });
});

describe('QA T13.1 PR 2 courier coker ve geri gelir (9)', () => {
  it('courier kapaliyken siparisler PAID bekler; ayni adreste geri gelince (devre yeniden kapaninca) atanir, cift atama yok', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(3);
    const port = await freeFixedPort();
    const first = await courierOnMongo({ dbName: dbs.courier, placed, clock, port });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: first.service.address,
      clock,
    });
    const before = await side.paid();

    await first.service.stop();
    const during = await side.paid();
    for (let tour = 0; tour < 7; tour += 1) {
      await side.tour();
    }
    const waiting = await ordersOf(side, [before.id, during.id]);
    const back = await courierOnMongo({ dbName: dbs.courier, clock, port });
    const recovered = await waitFor(async () => {
      await side.tour();
      const orders = await ordersOf(side, [before.id, during.id]);
      return orders.every((order) => order.courier !== undefined);
    }, DEPENDENCY_BREAKER_OPEN_MS + 10_000);
    const after = await ordersOf(side, [before.id, during.id]);

    expect(waiting.map((order) => order.status)).toEqual([ORDER_STATUS.PAID, ORDER_STATUS.PAID]);
    expect(recovered).toBe(true);
    expect(new Set(after.map((order) => order.courier?.courierId)).size).toBe(2);
    expect(await crossCheck(back.service, placed, after)).toEqual([]);
  });
});

/** Profiler satiri: servisin GONDERDIGI sorgu ve plani (dis veri: semadan gecer). */
const profileEntrySchema = z
  .object({
    planSummary: z.string().optional(),
    keysExamined: z.number().optional(),
    hasSortStage: z.boolean().optional(),
    command: z.object({ filter: z.unknown().optional() }).passthrough().optional(),
  })
  .passthrough();

describe('QA T13.1 PR 2 iscinin kuyruk sorgusu (13)', () => {
  it('profiler: sorgu kismi indeksten okunur, COLLSCAN ve bellekte siralama yok; teslim/iptal gecmisi indekse girmez', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const courier = await courierOnMongo({ dbName: dbs.courier, placed: [], clock });
    const side = await orderOnMongo({
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
    });
    const history: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      history.push((await side.paid()).id);
    }
    const orders = raw.db(dbs.order).collection<OrderDocument>(COLLECTIONS.ORDERS);
    await orders.updateMany(
      { _id: { $in: history.slice(0, 30) } },
      {
        $set: { status: ORDER_STATUS.DELIVERED },
      },
    );
    await orders.updateMany(
      { _id: { $in: history.slice(30) } },
      {
        $set: { status: ORDER_STATUS.CANCELLED },
      },
    );
    const live = [(await side.paid()).id, (await side.paid()).id, (await side.paid()).id];

    await raw.db(dbs.order).command({ profile: 2 });
    await side.tour();
    await raw.db(dbs.order).command({ profile: 0 });
    const entries = (
      await raw
        .db(dbs.order)
        .collection('system.profile')
        .find({ ns: `${dbs.order}.${COLLECTIONS.ORDERS}`, op: 'query' })
        .toArray()
    ).map((entry) => profileEntrySchema.parse(entry));
    const queue = entries.filter((entry) => JSON.stringify(entry.command?.filter).includes('$or'));
    const validation = z
      .object({ keysPerIndex: z.record(z.number()) })
      .passthrough()
      .parse(await raw.db(dbs.order).command({ validate: COLLECTIONS.ORDERS }));

    expect(queue.length).toBeGreaterThan(0);
    for (const entry of queue) {
      // Plan ozeti indeksi anahtariyla yazar: status_courierRetryAt_id.
      expect(entry.planSummary).toContain('IXSCAN { status: 1, courierRetryAt: 1, _id: 1 }');
      expect(entry.planSummary).not.toContain('COLLSCAN');
      expect(entry.hasSortStage ?? false).toBe(false);
      expect(entry.keysExamined ?? 0).toBeLessThanOrEqual(live.length + 2);
    }
    // Kismi indeks: yalnizca kurye bekleyebilen (PAID, PREPARING) siparisler; 40 gecmis disarida.
    expect(validation.keysPerIndex.status_courierRetryAt_id).toBe(live.length);
  });
});
