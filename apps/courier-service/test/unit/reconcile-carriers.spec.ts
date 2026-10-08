/**
 * BUSY kalan kurye uzlastirmasi (#205; reconcile-carriers.ts) ve tick turundaki
 * araligi (advance-routes.ts). Bellek depolari, sabit saat.
 */

import { fixedClock, silentLogger } from '@getir/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdvanceRoutes } from '../../src/application/advance-routes.js';
import { createReconcileCarriers } from '../../src/application/reconcile-carriers.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Courier } from '../../src/domain/courier.js';
import { ROUTE_STATE } from '../../src/domain/route.js';
import type { Route, RoutePatch } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import { courierLocation, routeProgress } from '../../src/domain/route-progress.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { InMemoryRouteStore } from '../../src/infrastructure/memory/in-memory-route-store.js';
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
} from '../support/couriers.js';

const RULE = { speedKmh: 36, prepSeconds: 30 };
const GRACE_MS = 30_000;
const ASSIGNED_AT = northOf(MARKET_LOCATION, 600);

let clock: ReturnType<typeof fixedClock>;
let couriers: InMemoryCourierStore;
let routes: InMemoryRouteStore;
let fleet: Courier[];

/** Kurye filosunu (n. kuryeyi degistirerek) depoya yazar. */
async function setCourier(entry: Courier): Promise<void> {
  fleet = [...fleet.filter((other) => other.id !== entry.id), entry];
  await couriers.replaceAll(fleet, []);
}

const reconciler = (batchSize = 200) =>
  createReconcileCarriers({ couriers, routes, rule: RULE, batchSize, graceMs: GRACE_MS, clock });

const reconcile = () => reconciler()(silentLogger);

/** n. kuryenin tasidigi siparis ve rotasi; `patch` rotanin son hali. */
async function carrying(n: number, patch: RoutePatch = {}): Promise<Route> {
  const order = orderId();
  await setCourier(
    courier(n, {
      status: COURIER_STATUS.BUSY,
      currentOrderId: order,
      lastLocation: ASSIGNED_AT,
      lastAssignedAt: new Date(NOW_MS),
    }),
  );
  const route = await routes.insertOnce({
    orderId: order,
    courierId: courierId(n),
    ...planRoute({ from: ASSIGNED_AT, pickup: MARKET_LOCATION, dropoff: DELIVERY }, ROUTE_RULE),
    createdAt: new Date(NOW_MS),
    marketId: MARKET,
    movement: RULE,
    state: ROUTE_STATE.MOVING,
  });
  return (await routes.update(route, patch)) ?? route;
}

beforeEach(() => {
  clock = fixedClock(NOW_MS);
  couriers = new InMemoryCourierStore();
  routes = new InMemoryRouteStore();
  fleet = [];
});

describe('BUSY kalan kurye uzlastirmasi (#205)', () => {
  it('ara hatadan sonra (rota ENDED, kurye hala BUSY): kurye BITIS ANINDAKI konumda birakilir', async () => {
    const endedAt = new Date(NOW_MS + 60_000);
    const route = await carrying(1, { state: ROUTE_STATE.ENDED, endedAt });
    clock.set(endedAt.getTime() + GRACE_MS);

    expect(await reconcile()).toBe(1);

    expect(await couriers.findById(courierId(1))).toMatchObject({
      status: COURIER_STATUS.IDLE,
      lastLocation: courierLocation(route, routeProgress(route, endedAt, RULE)),
      lastLocationAt: endedAt,
      idleSince: endedAt,
    });
    expect((await couriers.findById(courierId(1)))?.currentOrderId).toBeUndefined();
    // Tekrar guvenli: ikinci tur bir sey yapmaz.
    expect(await reconcile()).toBe(0);
  });

  it('bekleme payi dolmadan dokunulmaz (ReleaseCourier ile yarismasin)', async () => {
    const endedAt = new Date(NOW_MS + 60_000);
    await carrying(1, { state: ROUTE_STATE.ENDED, endedAt });
    clock.set(endedAt.getTime() + GRACE_MS - 1);

    expect(await reconcile()).toBe(0);
    expect((await couriers.findById(courierId(1)))?.status).toBe(COURIER_STATUS.BUSY);
  });

  it('normal yolda hicbir sey yapmaz: ilerleyen rota ve rotasiz atama', async () => {
    await carrying(1);
    // Rotasiz atama (market konumu bilinmiyordu).
    await setCourier(
      courier(2, {
        status: COURIER_STATUS.BUSY,
        currentOrderId: orderId(),
        lastAssignedAt: new Date(NOW_MS),
      }),
    );
    clock.set(NOW_MS + 3_600_000);

    expect(await reconcile()).toBe(0);
    expect((await couriers.findById(courierId(1)))?.status).toBe(COURIER_STATUS.BUSY);
    expect((await couriers.findById(courierId(2)))?.status).toBe(COURIER_STATUS.BUSY);
  });

  it('teslim kazanmissa (rota DONE, teslimli) kurye ADRESTE, teslim aninda birakilir', async () => {
    const deliveredAt = new Date(NOW_MS + 200_000);
    await carrying(1, { deliveredAt, deliveryPublished: true, state: ROUTE_STATE.DONE });
    clock.set(deliveredAt.getTime() + GRACE_MS);

    expect(await reconcile()).toBe(1);

    expect(await couriers.findById(courierId(1))).toMatchObject({
      status: COURIER_STATUS.IDLE,
      lastLocation: DELIVERY,
      idleSince: deliveredAt,
    });
  });

  it('baska atamanin kuryesine dokunmaz: kurye ayni siparisi rotadan SONRA yeniden aldi', async () => {
    const endedAt = new Date(NOW_MS + 60_000);
    const route = await carrying(1, { state: ROUTE_STATE.ENDED, endedAt });
    await setCourier(
      courier(1, {
        status: COURIER_STATUS.BUSY,
        currentOrderId: route.orderId,
        lastLocation: ASSIGNED_AT,
        lastAssignedAt: new Date(NOW_MS + 90_000),
      }),
    );
    clock.set(NOW_MS + 3_600_000);

    expect(await reconcile()).toBe(0);
    expect((await couriers.findById(courierId(1)))?.status).toBe(COURIER_STATUS.BUSY);
  });

  it('bitis ani olmayan ENDED rota: kurye SIMDI, konumu degismeden birakilir', async () => {
    await carrying(1, { state: ROUTE_STATE.ENDED });
    clock.set(NOW_MS + 90_000);

    expect(await reconcile()).toBe(1);

    expect(await couriers.findById(courierId(1))).toMatchObject({
      status: COURIER_STATUS.IDLE,
      lastLocation: ASSIGNED_AT,
      idleSince: new Date(NOW_MS + 90_000),
    });
  });

  it('BUSY olmayan (tutarsiz) kuryeye dokunmaz', async () => {
    const endedAt = new Date(NOW_MS + 60_000);
    const route = await carrying(1, { state: ROUTE_STATE.ENDED, endedAt });
    await setCourier(
      courier(1, {
        status: COURIER_STATUS.OFFLINE,
        currentOrderId: route.orderId,
        lastLocation: ASSIGNED_AT,
        lastAssignedAt: new Date(NOW_MS),
      }),
    );
    clock.set(NOW_MS + 3_600_000);

    expect(await reconcile()).toBe(0);
    expect((await couriers.findById(courierId(1)))?.currentOrderId).toBe(route.orderId);
  });

  it('SAYFALI: takili kurye, normal yoldaki kuryelerin arkasinda kalmaz; sonda basa doner', async () => {
    const all = [await carrying(1), await carrying(2), await carrying(3)].sort((a, b) =>
      a.orderId.localeCompare(b.orderId),
    );
    const endedAt = new Date(NOW_MS + 60_000);
    const last = all[2];
    await routes.update(last as Route, { state: ROUTE_STATE.ENDED, endedAt });
    clock.set(endedAt.getTime() + GRACE_MS);
    const listCarrying = vi.spyOn(couriers, 'listCarrying');
    const run = reconciler(2);

    expect(await run(silentLogger)).toBe(0);
    expect(await run(silentLogger)).toBe(1);
    expect(await run(silentLogger)).toBe(0);

    expect(listCarrying.mock.calls).toEqual([
      [2, undefined],
      [2, all[1]?.orderId],
      [2, undefined],
    ]);
    expect((await couriers.findById(last?.courierId ?? ''))?.status).toBe(COURIER_STATUS.IDLE);
  });

  it('BUTCE: her birakmadan once sorulur; doldugunda kalanlar sonraki kosuda', async () => {
    const endedAt = new Date(NOW_MS + 60_000);
    await carrying(1, { state: ROUTE_STATE.ENDED, endedAt });
    await carrying(2, { state: ROUTE_STATE.ENDED, endedAt });
    clock.set(endedAt.getTime() + GRACE_MS);
    const shouldContinue = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    expect(await reconciler()(silentLogger, shouldContinue)).toBe(1);

    expect(shouldContinue).toHaveBeenCalledTimes(2);
    expect(await reconcile()).toBe(1);
  });

  it('TOPLU: kuryeler ve rotalari birer okumayla (N+1 yok)', async () => {
    const endedAt = new Date(NOW_MS + 60_000);
    await carrying(1, { state: ROUTE_STATE.ENDED, endedAt });
    await carrying(2, { state: ROUTE_STATE.ENDED, endedAt });
    await carrying(3);
    clock.set(endedAt.getTime() + GRACE_MS);
    const listCarrying = vi.spyOn(couriers, 'listCarrying');
    const findByOrders = vi.spyOn(routes, 'findByOrders');
    const findByOrder = vi.spyOn(routes, 'findByOrder');

    expect(await reconcile()).toBe(2);

    expect(listCarrying).toHaveBeenCalledTimes(1);
    expect(findByOrders).toHaveBeenCalledTimes(1);
    expect(findByOrders.mock.calls[0]?.[0]).toHaveLength(3);
    expect(findByOrder).not.toHaveBeenCalled();
  });
});

describe('tick turunda uzlastirma araligi (#205)', () => {
  it('en fazla aralikta bir kosar; hatasi turu bozmaz ve rota hatasi sayilmaz', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('mongo'))
      .mockResolvedValue(0);
    const round = createAdvanceRoutes({
      routes,
      couriers,
      advance: () => Promise.reject(new Error('rota yok')),
      batchSize: 200,
      reconcile: { run, intervalMs: 30_000, clock },
    });

    expect((await round(silentLogger)).reconciled).toBe(1);
    clock.advance(29_999);
    expect((await round(silentLogger)).reconciled).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(await round(silentLogger)).toMatchObject({ failed: 0, reconciled: 0 });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('turun BASINDA, rotalardan once ve ayni butceyle kosar', async () => {
    const run = vi.fn().mockResolvedValue(0);
    const listMoving = vi.spyOn(routes, 'listMoving');
    const shouldContinue = () => true;
    const round = createAdvanceRoutes({
      routes,
      couriers,
      advance: () => Promise.reject(new Error('rota yok')),
      batchSize: 200,
      reconcile: { run, intervalMs: 30_000, clock },
    });

    await round(silentLogger, shouldContinue);

    expect(run).toHaveBeenCalledWith(silentLogger, shouldContinue);
    expect(run.mock.invocationCallOrder[0]).toBeLessThan(
      listMoving.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('tur kesildiyse (butce doldu) uzlastirma o turda kosmaz', async () => {
    const run = vi.fn().mockResolvedValue(0);
    const round = createAdvanceRoutes({
      routes,
      couriers,
      advance: () => Promise.reject(new Error('rota yok')),
      batchSize: 200,
      reconcile: { run, intervalMs: 30_000, clock },
    });

    await round(silentLogger, () => false);

    expect(run).not.toHaveBeenCalled();
  });
});
