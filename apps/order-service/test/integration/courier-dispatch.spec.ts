/**
 * Kurye atayan iscinin turu GERCEK Mongo'da (Testcontainers), T13.1 PR 2.
 * courier-svc sahte (FakeCourierAssignment: courier'in kurallari bellekte);
 * siparis deposu servisin acilis yoluyla (openOrderStore) acilir.
 *
 *  1. "Bitti sayilir": odenen siparis kuryeyle PREPARING'e gecer; gecisin olayi
 *     ayni transaction'da outbox'ta (realtime PREPARING'i T12.3 hattiyla iter).
 *  2. Bos kurye yoksa deneme ani belgeye yazilir, 30 sn sonra kurye atanir.
 *  3. QA T3: birakma ucustaki atamadan once gelir; siparis iptal edilir; Mongo'nun
 *     surum kosulu atamanin yazimini reddeder ve kurye geri verilir.
 *  4. Iki order ornegi ayni siparisleri es zamanli isler: siparis basina tek
 *     kurye, tek PAID -> PREPARING olayi, geri verilen kurye yok.
 *  5. #92 (T13.2): bekleyen siparis, ondan sonra odeyen siparise kuryeyi
 *     kaptirmaz (QA'nin W/N senaryosu); kuyruk ani belgede, ataninca silinir.
 */

import { fixedClock, ORDER_STATUS, silentLogger } from '@getir/core';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDispatchCouriers } from '../../src/application/dispatch-couriers.js';
import {
  COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  COURIER_DISPATCH_BATCH_SIZE,
  COURIER_RETRY_DELAY_MS,
} from '../../src/config/constants.js';
import { statusChangedEvents } from '../../src/domain/order-events.js';
import type { Order } from '../../src/domain/order.js';
import { transitionOrder } from '../../src/domain/order.js';
import { COLLECTIONS } from '../../src/infrastructure/mongo/documents.js';
import { openOrderStore } from '../../src/infrastructure/order-store.js';
import type { OrderStore } from '../../src/infrastructure/order-store.js';
import { FakeCourierAssignment } from '../support/fake-courier-assignment.js';
import { insertPaid } from '../support/order-builders.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const MONGO_IMAGE = 'mongo:7';
const DB_NAME = 'getir_order_courier_test';
const PAID_MS = 1_760_000_000_000;

let container: StartedMongoDBContainer;
let store: OrderStore;
/** Ham istemci: belgeyi ve outbox satirlarini servisin disindan okumak icin. */
let raw: MongoClient;
let courier: FakeCourierAssignment;
/** Her test kendi marketinde: paylasilan koleksiyonda turlar birbirinin siparisine dokunmasin. */
let market: string;
let marketCounter = 0;

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  const uri = `${container.getConnectionString()}?directConnection=true`;
  store = await openOrderStore(
    { uri, dbName: DB_NAME, serverSelectionTimeoutMs: 5_000, operationTimeoutMs: 2_000 },
    silentLogger,
    'test',
  );
  raw = await MongoClient.connect(uri);
});

afterAll(async () => {
  await raw?.close();
  await store?.close();
  await container?.stop();
});

beforeEach(async () => {
  courier = new FakeCourierAssignment();
  marketCounter += 1;
  market = `mkt_kurye-test-${marketCounter}`;
  // Onceki testlerin kuryesiz kalan siparisleri bu turlara girmesin.
  await raw
    .db(DB_NAME)
    .collection(COLLECTIONS.ORDERS)
    .updateMany({ status: { $in: ['PAID', 'PREPARING'] } }, { $set: { status: 'DELIVERED' } });
});

function dispatch(nowMs: number) {
  return createDispatchCouriers({
    awaiting: store.awaitingCourier,
    repository: store.repository,
    courier,
    clock: fixedClock(nowMs),
    batchSize: COURIER_DISPATCH_BATCH_SIZE,
    retryDelayMs: COURIER_RETRY_DELAY_MS,
    writeAttempts: COURIER_ASSIGNMENT_WRITE_ATTEMPTS,
  })(silentLogger);
}

const paid = () => insertPaid(store.repository, fixedClock(PAID_MS), { marketId: market });
const paidAt = (atMs: number) =>
  insertPaid(store.repository, fixedClock(atMs), { marketId: market });

async function documentOf(orderId: string): Promise<Document | null> {
  return raw
    .db(DB_NAME)
    .collection(COLLECTIONS.ORDERS)
    .findOne({ _id: orderId } as Document);
}

/** Siparisin outbox'taki order.status_changed govdeleri, surum sirasiyla. */
async function statusEventsOf(orderId: string): Promise<Document[]> {
  const rows = await raw
    .db(DB_NAME)
    .collection(COLLECTIONS.OUTBOX)
    .find({ aggregateId: orderId, topic: 'order.status_changed' })
    .sort({ version: 1 })
    .toArray();
  return rows.map((row) => ({
    ...(row['payload'] as Document),
    rowVersion: row['version'] as unknown,
  }));
}

/** Ayni siparisin ikinci istegi gelene kadar ilkini bekletir (en cok 2 sn). */
function meetBothInstances(): (orderId: string) => Promise<void> {
  const waiting = new Map<string, () => void>();
  return (orderId) => {
    const first = waiting.get(orderId);
    if (first !== undefined) {
      first();
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      waiting.set(orderId, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };
}

describe('kurye iscisi gercek Mongo da (T13.1 PR 2)', () => {
  it('odenen siparis kuryeyle PREPARING; gecisin olayi ayni transaction da outbox ta', async () => {
    courier.addIdle(market, 'crr_1');
    const order = await paid();
    const now = PAID_MS + 1_000;

    await expect(dispatch(now)).resolves.toMatchObject({ assigned: 1 });

    expect(await documentOf(order.id)).toMatchObject({
      status: 'PREPARING',
      courier: { courierId: 'crr_1', assignedAt: new Date(now) },
      version: order.version + 1,
    });
    expect((await statusEventsOf(order.id)).at(-1)).toMatchObject({
      from: 'PAID',
      to: 'PREPARING',
      version: order.version + 1,
      rowVersion: order.version + 1,
    });
  });

  it('bos kurye yok: deneme ani belgede; 30 sn sonra kurye atanir, ikinci olay YOK', async () => {
    const order = await paid();
    const first = PAID_MS + 1_000;

    await expect(dispatch(first)).resolves.toMatchObject({ noCourier: 1 });
    const waiting = await documentOf(order.id);
    expect(waiting).toMatchObject({
      status: 'PREPARING',
      courierRetryAt: new Date(first + COURIER_RETRY_DELAY_MS),
    });
    expect(waiting).not.toHaveProperty('courier');

    courier.addIdle(market, 'crr_2');
    await expect(dispatch(first + COURIER_RETRY_DELAY_MS - 1)).resolves.toMatchObject({
      assigned: 0,
    });
    await expect(dispatch(first + COURIER_RETRY_DELAY_MS)).resolves.toMatchObject({ assigned: 1 });

    const assigned = await documentOf(order.id);
    expect(assigned).toMatchObject({ courier: { courierId: 'crr_2' } });
    expect(assigned).not.toHaveProperty('courierRetryAt');
    expect(
      (await statusEventsOf(order.id)).filter((event) => event['to'] === 'PREPARING'),
    ).toHaveLength(1);
  });

  it('#92 QA W/N: W bekliyor, kurye t+10 da bosalir, N t+11 de oder -> kurye W ye, N bekler; kuyruk ani belgede', async () => {
    const w = await paidAt(PAID_MS);
    await expect(dispatch(PAID_MS + 1_000)).resolves.toMatchObject({ noCourier: 1 });
    expect(await documentOf(w.id)).toMatchObject({
      status: 'PREPARING',
      courierQueuedAt: new Date(PAID_MS),
    });

    courier.addIdle(market, 'crr_1');
    const n = await paidAt(PAID_MS + 11_000);
    await expect(dispatch(PAID_MS + 11_000)).resolves.toMatchObject({
      assigned: 1,
      noCourier: 1,
    });

    expect(courier.assignments.map((request) => request.orderId)).toEqual([w.id, w.id, n.id]);
    const served = await documentOf(w.id);
    expect(served).toMatchObject({ courier: { courierId: 'crr_1' } });
    expect(served).not.toHaveProperty('courierQueuedAt');
    expect(await documentOf(n.id)).toMatchObject({
      status: 'PREPARING',
      courierQueuedAt: new Date(PAID_MS + 11_000),
      courierRetryAt: new Date(PAID_MS + 11_000 + COURIER_RETRY_DELAY_MS),
    });
  });

  it('QA T3: birakma ucustaki atamadan once gelir, siparis iptal; surum kosulu yazimi reddeder, kurye GERI VERILIR', async () => {
    courier.addIdle(market, 'crr_1');
    const order = await paid();
    courier.beforeAssignApplies = async (orderId) => {
      const current = await store.repository.findById(orderId);
      if (current === null) throw new Error('siparis yok');
      const cancelled = transitionOrder(current, ORDER_STATUS.CANCELLED, fixedClock(PAID_MS));
      await store.repository.update(
        cancelled,
        current.version,
        statusChangedEvents(current, cancelled),
      );
      await courier.release(orderId, { requestId: 'req_iptal', logger: silentLogger });
    };

    await expect(dispatch(PAID_MS + 1_000)).resolves.toMatchObject({ released: 1, failed: 0 });

    expect(courier.releases).toEqual([
      { orderId: order.id, released: false },
      { orderId: order.id, released: true },
    ]);
    expect(courier.carrying.has(order.id)).toBe(false);
    const document = await documentOf(order.id);
    expect(document).toMatchObject({ status: 'CANCELLED' });
    expect(document).not.toHaveProperty('courier');
  });

  it('iki order ornegi ayni siparisleri es zamanli isler: siparis basina tek kurye ve tek olay', async () => {
    const couriers = Array.from({ length: 10 }, (_, index) => `crr_${index + 1}`);
    courier.addIdle(market, ...couriers);
    const orders: Order[] = [];
    for (let index = 0; index < 10; index += 1) {
      orders.push(await paid());
    }
    // Bariyer: her siparisin atamasi iki ornek de onu isteyene kadar bekler;
    // boylece iki tur AYNI siparisi ayni anda yazar (yaris her siparis icin kurulur).
    courier.beforeAssignApplies = meetBothInstances();

    const rounds = await Promise.all([dispatch(PAID_MS + 1_000), dispatch(PAID_MS + 1_000)]);

    const total = (key: 'assigned' | 'skipped' | 'failed' | 'released') =>
      rounds.reduce((sum, round) => sum + round[key], 0);
    expect(courier.assignments).toHaveLength(20);
    expect(total('assigned')).toBe(10);
    expect(total('skipped')).toBe(10);
    expect(total('failed') + total('released')).toBe(0);
    const written = await Promise.all(orders.map((order) => documentOf(order.id)));
    const courierIds = written.map(
      (document) => (document?.['courier'] as { courierId?: unknown } | undefined)?.courierId,
    );
    expect(new Set(courierIds).size).toBe(10);
    expect(courierIds.sort()).toEqual([...couriers].sort());
    for (const order of orders) {
      expect(
        (await statusEventsOf(order.id)).filter((event) => event['to'] === 'PREPARING'),
      ).toHaveLength(1);
    }
    expect(courier.releases).toEqual([]);
  });
});
