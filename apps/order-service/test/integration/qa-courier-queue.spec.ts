/**
 * QA kara kutu (T13.2 PR 2: #92 FIFO ve O2), gercek Mongo + gercek courier gRPC.
 * Backend'in kuyruk testleri sahte courier'le ve bellekte; burada courier'in kendi
 * havuzu, iki order kopyasi ve Mongo'daki surumler.
 *
 *   1. W/N iki order kopyasiyla: W bekler, kurye t+10'da bosalir, N t+11'de oder ->
 *      kurye W'ye gider (deneme ani gelmemis olsa da), N bekler; tek atama, tek olay.
 *   2. Kitlikta yuk (O2): uc markette 30 bekleyen + her turda yeni odeme; turda
 *      courier cagrisi <= kurye bulamayan market sayisi, bekleyen YAZIMI 0; deneme
 *      ani gectikten sonra da (her tur denenir) ayni sinir.
 *   3. Aclik yok: 150 bekleyen (tur sinirinin ustu), HICBIRININ deneme ani gelmemis,
 *      + surekli yeni odeme; bosalan kurye her seferinde EN ESKI bekleyene gider (onu
 *      yalnizca kuyruk sorgusunun sirasi bulur), yeni gelen one gecemez.
 */

import { fixedClock, ID_PREFIX, newId, ORDER_STATUS } from '@getir/core';
import type { LogLine } from '@getir/core/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Order } from '../../src/domain/order.js';
import { crossCheck, placeCouriers, QA_NOW_MS } from '../support/qa-courier-world.js';
import {
  assignRequests,
  courierOnMongo,
  orderOnMongo,
  preparingEvents,
} from '../support/qa-mongo-world.js';
import type { Cleanups, QaOrderSide } from '../support/qa-mongo-world.js';

const MONGO_IMAGE = 'mongo:7';
/** Ayni semtte (Kadikoy) iki market ve obur semtte (Besiktas) bir market: ucu de demo kopyasinda. */
const MARKETS = ['mkt_migros-jet-moda', 'mkt_a101-caferaga', 'mkt_migros-jet-besiktas'] as const;

const marketAt = (index: number): string => MARKETS[index % MARKETS.length] ?? MARKETS[0];

let container: StartedMongoDBContainer;
let raw: MongoClient;
const cleanups: Cleanups = [];

const uri = (): string => `${container.getConnectionString()}/?directConnection=true`;
const freshDbs = () => {
  const tag = newId(ID_PREFIX.EVENT).slice(-8);
  return { order: `qa_order_${tag}`, courier: `qa_courier_${tag}` };
};

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  raw = await MongoClient.connect(uri());
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

async function ordersOf(side: QaOrderSide, ids: readonly string[]): Promise<Order[]> {
  const found = await Promise.all(ids.map((id) => side.order(id)));
  return found.flatMap((order) => (order === null ? [] : [order]));
}

describe('QA T13.2 kurye kuyrugu (#92, O2), gercek courier + gercek Mongo', () => {
  it('1. W/N iki order kopyasiyla: bosalan kurye once odemis W ye gider (deneme ani gelmeden), N bekler; tek atama, tek olay', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(1);
    const courier = await courierOnMongo({
      uri: uri(),
      dbName: dbs.courier,
      placed,
      clock,
      cleanups,
    });
    const a = await orderOnMongo({
      uri: uri(),
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
      cleanups,
    });
    const b = await orderOnMongo({
      uri: uri(),
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
      cleanups,
    });
    const first = await a.paid();
    await a.tour(); // tek kurye ilk siparise
    clock.advance(1_000);
    const w = await a.paid();
    await Promise.all([a.tour(), b.tour()]); // W: kurye yok, bekler

    clock.advance(10_000);
    expect((await courier.service.release(first.id))?.released).toBe(true); // teslimat bitti
    clock.advance(1_000);
    const n = await b.paid(); // W'nin deneme ani (t+31) henuz gelmedi
    await Promise.all([a.tour(), b.tour()]);
    const now = await ordersOf(a, [w.id, n.id]);
    const [wNow, nNow] = now;

    expect(wNow?.courier?.courierId).toBe(placed[0]?.id);
    expect(nNow).toMatchObject({ status: ORDER_STATUS.PREPARING });
    expect(nNow?.courier).toBeUndefined();
    expect(await crossCheck(courier.service, placed, now)).toEqual([]);
    expect(await preparingEvents(raw, dbs.order, w.id)).toBe(1);
    expect(await preparingEvents(raw, dbs.order, n.id)).toBe(1);
  });

  it('2. kitlikta yuk (O2): 3 markette 30 bekleyen + her turda yeni odeme; turda cagri <= market sayisi, bekleyen yazimi 0; deneme ani gecince de', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const courierLines: LogLine[] = [];
    const courier = await courierOnMongo({
      uri: uri(),
      dbName: dbs.courier,
      placed: [],
      clock,
      lines: courierLines,
      cleanups,
    });
    const side = await orderOnMongo({
      uri: uri(),
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
      cleanups,
    });
    const waiting: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      clock.advance(1_000);
      waiting.push((await side.paid({ marketId: marketAt(index) })).id);
    }
    await side.tour();
    const settled = await ordersOf(side, waiting);
    const versions = new Map(settled.map((order) => [order.id, order.version]));

    const perTour: number[] = [];
    for (let round = 0; round < 6; round += 1) {
      clock.advance(1_000);
      await side.paid({ marketId: marketAt(round) });
      const before = assignRequests(courierLines);
      await side.tour();
      perTour.push(assignRequests(courierLines) - before);
    }
    // Deneme anlari gecti: bekleyenler talep olmadan da her turda denenir.
    clock.advance(31_000);
    for (let round = 0; round < 3; round += 1) {
      const before = assignRequests(courierLines);
      await side.tour();
      perTour.push(assignRequests(courierLines) - before);
      clock.advance(1_000);
    }
    const after = await ordersOf(side, waiting);

    expect(
      settled.every(
        (order) => order.status === ORDER_STATUS.PREPARING && order.courier === undefined,
      ),
    ).toBe(true);
    expect(Math.max(...perTour)).toBeLessThanOrEqual(MARKETS.length);
    expect(Math.min(...perTour)).toBeGreaterThan(0);
    expect(after.filter((order) => order.version !== versions.get(order.id))).toEqual([]);
    for (const id of waiting.slice(0, 3)) {
      expect(await preparingEvents(raw, dbs.order, id)).toBe(1);
    }
  });

  it('3. aclik yok: deneme ani gelmemis 150 bekleyen (tur sinirinin ustu) ve surekli yeni odeme; bosalan kurye her seferinde EN ESKI bekleyene gider', async () => {
    const dbs = freshDbs();
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(1);
    const courier = await courierOnMongo({
      uri: uri(),
      dbName: dbs.courier,
      placed,
      clock,
      cleanups,
    });
    const side = await orderOnMongo({
      uri: uri(),
      dbName: dbs.order,
      courierAddress: courier.service.address,
      clock,
      cleanups,
    });
    let holder = await side.paid();
    await side.tour(); // tek kurye bu sipariste
    // 15 sn icinde 150 odeme; iki tur hepsini kuryesiz bekletir (deneme anlari +30 sn).
    const waiting: string[] = [];
    for (let index = 0; index < 150; index += 1) {
      clock.advance(100);
      waiting.push((await side.paid()).id);
    }
    await side.tour();
    await side.tour();
    const settled = await ordersOf(side, waiting);
    expect(settled.filter((order) => order.status !== ORDER_STATUS.PREPARING)).toEqual([]);

    const served: string[] = [];
    const newcomers: string[] = [];
    for (let round = 0; round < 6; round += 1) {
      clock.advance(1_000);
      expect((await courier.service.release(holder.id))?.released).toBe(true);
      newcomers.push((await side.paid()).id); // yeni odeme ayni turda yarisir
      await side.tour();
      const taken = (await ordersOf(side, [...waiting, ...newcomers])).find(
        (order) => order.courier?.courierId === placed[0]?.id && !served.includes(order.id),
      );
      if (taken === undefined) throw new Error(`tur ${round}: kurye kimseye gitmedi`);
      served.push(taken.id);
      holder = taken;
    }
    const newcomersNow = await ordersOf(side, newcomers);

    expect(served).toEqual(waiting.slice(0, 6));
    expect(newcomersNow.every((order) => order.courier === undefined)).toBe(true);
  });
});
