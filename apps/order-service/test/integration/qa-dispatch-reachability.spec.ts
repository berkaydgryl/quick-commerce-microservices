/**
 * QA kara kutu (T13.2 PR 2, D1): ulasilamamanin KAYNAGI, uretimdeki isciyle
 * (startCourierDispatching, gercek zamanlayici), gercek Mongo ve gercek courier.
 * Backend'in isci testleri tur sonucunu sahte verir; burada hata surucuden
 * (islem suresi), gRPC'den (baglanti reddi) ve D17 devresinden gelir.
 *
 *   1. Order'in Mongo'su donar (vekil): yalnizca `store` icin TEK WARN, turlar
 *      metrikte `source=store`; cozulunce TEK INFO ve yeni siparis atanir.
 *      Courier'e hic sorulmadigi icin courier ulasilamaz SANILMAZ.
 *   2. Courier coker; o arada depo da kisa donar: kaynaklar karismaz. Depo donunce
 *      depo INFO'su gelir ama courier hala yok: courier INFO'su YOK; courier ayni
 *      adreste geri gelince (devre yeniden kapaninca) tek INFO ve bekleyen atanir.
 */

import { ERROR_CODES, fixedClock, ID_PREFIX, isAppError, newId, ORDER_STATUS } from '@getir/core';
import type { MutableClock } from '@getir/core';
import type { LogLine } from '@getir/core/testing';
import { metricsRegistry } from '@getir/observability';
import { metricValue } from '@getir/observability/testing';
import { MongoDBContainer } from '@testcontainers/mongodb';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startFreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import type { FreezingProxy } from '../../../../packages/mongo-kit/test/support/freezing-proxy.js';
import { DEPENDENCY_BREAKER_OPEN_MS } from '../../src/config/constants.js';
import type { Order } from '../../src/domain/order.js';
import { ORDER_DISPATCHER_METRICS } from '../../src/interfaces/workers/dispatcher-metrics.js';
import {
  crossCheck,
  FREE_FIXED_PORT,
  placeCouriers,
  QA_NOW_MS,
  waitFor,
} from '../support/qa-courier-world.js';
import { courierOnMongo, orderOnMongo } from '../support/qa-mongo-world.js';
import type { Cleanups, QaOrderSide } from '../support/qa-mongo-world.js';

const MONGO_IMAGE = 'mongo:7';
const MONGO_PORT = 27_017;
/** Donmus depoda tur bu kadar bekler; yuklu makinede normal islem bunu asmasin. */
const FROZEN_TIMEOUT_MS = 1_000;
const WORKER_INTERVAL_MS = 200;
const SETTLE_MS = 15_000;

let container: StartedMongoDBContainer;
const cleanups: Cleanups = [];

const directUri = (): string => `${container.getConnectionString()}/?directConnection=true`;

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
});

beforeEach(() => {
  metricsRegistry.resetMetrics();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

afterAll(async () => {
  await container?.stop();
});

/** Iscinin kaynak gecis satirlari (siparise ait olmayan, `source`lu), sirasiyla kaynaklari. */
function transitions(lines: readonly LogLine[], level: 'warn' | 'info'): unknown[] {
  return lines
    .filter(
      (line) =>
        line.level === level &&
        line.fields.component === 'courier-dispatcher' &&
        line.fields.source !== undefined &&
        line.fields.orderId === undefined,
    )
    .map((line) => line.fields.source);
}

async function ordersOf(side: QaOrderSide, ids: readonly string[]): Promise<Order[]> {
  const found = await Promise.all(ids.map((id) => side.order(id)));
  return found.flatMap((order) => (order === null ? [] : [order]));
}

const errorsFrom = (source: string): Promise<number | undefined> =>
  metricValue(ORDER_DISPATCHER_METRICS.ERRORS, { source });

async function frozenOrderSide(options: {
  readonly courierAddress: string;
  readonly clock: MutableClock;
  readonly lines: LogLine[];
}): Promise<{ readonly side: QaOrderSide; readonly proxy: FreezingProxy }> {
  const proxy = await startFreezingProxy({
    host: container.getHost(),
    port: container.getMappedPort(MONGO_PORT),
  });
  cleanups.push(() => proxy.close());
  cleanups.push(() => proxy.thaw());
  const side = await orderOnMongo({
    uri: `mongodb://127.0.0.1:${proxy.port}/?directConnection=true`,
    dbName: `qa_order_${newId(ID_PREFIX.EVENT).slice(-8)}`,
    courierAddress: options.courierAddress,
    clock: options.clock,
    lines: options.lines,
    operationTimeoutMs: FROZEN_TIMEOUT_MS,
    cleanups,
  });
  return { side, proxy };
}

describe('QA T13.2 D1: ulasilamamanin kaynagi, uretimdeki isci', () => {
  it('1. order in Mongo su donar: yalnizca store icin tek WARN (SERVICE_UNAVAILABLE), turlar metrikte; cozulunce tek INFO, atama surer', async () => {
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(2);
    const courier = await courierOnMongo({
      uri: directUri(),
      dbName: `qa_courier_${newId(ID_PREFIX.EVENT).slice(-8)}`,
      placed,
      clock,
      cleanups,
    });
    const lines: LogLine[] = [];
    const { side, proxy } = await frozenOrderSide({
      courierAddress: courier.service.address,
      clock,
      lines,
    });
    const worker = side.startWorker(WORKER_INTERVAL_MS);
    cleanups.push(() => worker.stop());
    const first = await side.paid();
    expect(
      await waitFor(async () => (await side.order(first.id))?.courier !== undefined, SETTLE_MS),
    ).toBe(true);

    proxy.freeze(); // kuyruk bos: siradaki tur yalnizca okur, okuma donar
    const cut = await waitFor(async () => ((await errorsFrom('store')) ?? 0) >= 3, SETTLE_MS);
    proxy.thaw();
    const back = await waitFor(
      () => Promise.resolve(transitions(lines, 'info').length > 0),
      SETTLE_MS,
    );
    const second = await side.paid();
    const assigned = await waitFor(
      async () => (await side.order(second.id))?.courier !== undefined,
      SETTLE_MS,
    );
    const warn = lines.find((line) => line.level === 'warn' && line.fields.source === 'store');
    const cause = warn?.fields.err;

    expect(cut).toBe(true);
    expect(back).toBe(true);
    expect(assigned).toBe(true);
    expect(transitions(lines, 'warn')).toEqual(['store']);
    expect(transitions(lines, 'info')).toEqual(['store']);
    expect(isAppError(cause) && cause.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(await errorsFrom('courier')).toBeUndefined();
    expect(
      await crossCheck(courier.service, placed, await ordersOf(side, [first.id, second.id])),
    ).toEqual([]);
  });

  it('2. courier coker, arada depo da donar: kaynaklar karismaz; depo donunce courier hala yok, courier geri gelince tek INFO ve bekleyen atanir', async () => {
    const clock = fixedClock(QA_NOW_MS);
    const placed = placeCouriers(2);
    const courierDb = `qa_courier_${newId(ID_PREFIX.EVENT).slice(-8)}`;
    const crashed = await courierOnMongo({
      uri: directUri(),
      dbName: courierDb,
      placed,
      clock,
      port: FREE_FIXED_PORT,
      cleanups,
    });
    const { port } = crashed.service;
    const lines: LogLine[] = [];
    const { side, proxy } = await frozenOrderSide({
      courierAddress: crashed.service.address,
      clock,
      lines,
    });
    const worker = side.startWorker(WORKER_INTERVAL_MS);
    cleanups.push(() => worker.stop());

    await crashed.service.stop();
    const waiting = await side.paid();
    const courierCut = await waitFor(
      () => Promise.resolve(transitions(lines, 'warn').includes('courier')),
      SETTLE_MS,
    );
    proxy.freeze();
    const storeCut = await waitFor(
      () => Promise.resolve(transitions(lines, 'warn').includes('store')),
      SETTLE_MS,
    );
    proxy.thaw();
    const storeBack = await waitFor(
      () => Promise.resolve(transitions(lines, 'info').includes('store')),
      SETTLE_MS,
    );
    const infosWhileCourierDown = transitions(lines, 'info');
    const stillPaid = await side.order(waiting.id);

    const back = await courierOnMongo({
      uri: directUri(),
      dbName: courierDb,
      clock,
      port,
      cleanups,
    });
    const assigned = await waitFor(
      async () => (await side.order(waiting.id))?.courier !== undefined,
      DEPENDENCY_BREAKER_OPEN_MS + SETTLE_MS,
    );
    const written = await ordersOf(side, [waiting.id]);

    expect(courierCut).toBe(true);
    expect(storeCut).toBe(true);
    expect(storeBack).toBe(true);
    expect(infosWhileCourierDown).toEqual(['store']);
    expect(stillPaid).toMatchObject({ status: ORDER_STATUS.PAID });
    expect(stillPaid?.courier).toBeUndefined();
    expect(assigned).toBe(true);
    expect(transitions(lines, 'warn')).toEqual(['courier', 'store']);
    expect(transitions(lines, 'info')).toEqual(['store', 'courier']);
    expect(await errorsFrom('courier')).toBeGreaterThan(0);
    expect(await errorsFrom('store')).toBeGreaterThan(0);
    expect(written).toHaveLength(1);
    expect(await crossCheck(back.service, placed, written)).toEqual([]);
  });
});
