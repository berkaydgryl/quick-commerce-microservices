/**
 * Atamanin rotasi (T13.2, application/assignment-route.ts): uret, bir kez yaz,
 * tekrar isteklerde saklanani don; yeniden atamada yenile; market yoksa uyar.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAssignmentRoute } from '../../src/application/assignment-route.js';
import type { AssignmentRoute } from '../../src/application/assignment-route.js';
import { planRoute } from '../../src/domain/route-planner.js';
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
  TEST_MARKETS,
} from '../support/couriers.js';
import { ROUTE_STATE } from '../../src/domain/route.js';

let routes: InMemoryRouteStore;
let lines: LogLine[];
let routeOf: AssignmentRoute;
let clockMs: number;

beforeEach(() => {
  routes = new InMemoryRouteStore();
  lines = [];
  clockMs = NOW_MS;
  routeOf = createAssignmentRoute({
    routes,
    markets: new InMemoryCourierStore([], TEST_MARKETS),
    rule: ROUTE_RULE,
    clock: { now: () => clockMs, date: () => new Date(clockMs) },
  });
});

const away = northOf(MARKET_LOCATION, 700);
const request = (
  order: string,
  holder = courier(1, { lastLocation: away }),
  marketId = MARKET,
) => ({
  orderId: order,
  courier: holder,
  marketId,
  deliveryLocation: DELIVERY,
});

describe('createAssignmentRoute', () => {
  it('uretir ve yazar: kurye -> market -> adres, siparis, kurye ve market kimligiyle, atama aninda; ilerliyor (T13.3)', async () => {
    const order = orderId();

    const route = await routeOf(request(order), recordingLogger(lines));

    expect(route).toEqual({
      orderId: order,
      courierId: courierId(1),
      ...planRoute({ from: away, pickup: MARKET_LOCATION, dropoff: DELIVERY }, ROUTE_RULE),
      createdAt: new Date(NOW_MS),
      marketId: MARKET,
      state: ROUTE_STATE.MOVING,
    });
    expect(await routes.findByOrder(order)).toEqual(route);
    expect(lines).toEqual([]);
  });

  it('tekrar istek saklanan rotayi doner: kurye o arada yer degistirse de ayni nokta ve ETA', async () => {
    const order = orderId();
    const first = await routeOf(request(order), recordingLogger(lines));
    clockMs += 90_000;

    const again = await routeOf(
      request(order, courier(1, { lastLocation: northOf(MARKET_LOCATION, 1_500) })),
      recordingLogger(lines),
    );

    expect(again).toEqual(first);
  });

  it('atama marketi zaten bulduysa tekrar okumaz (verilen konum kullanilir)', async () => {
    const order = orderId();
    const elsewhere = northOf(MARKET_LOCATION, 2_000);

    const route = await routeOf(
      { ...request(order), marketLocation: elsewhere },
      recordingLogger(lines),
    );

    expect(route?.points[route.pickupIndex]).toEqual(elsewhere);
  });

  it('siparis baska kuryeye atandiysa rota yenilenir (INFO); yeni kurye kendi konumundan', async () => {
    const order = orderId();
    await routeOf(request(order), recordingLogger(lines));
    const other = courier(2, { lastLocation: northOf(MARKET_LOCATION, 200) });

    const renewed = await routeOf(request(order, other), recordingLogger(lines));

    expect(renewed?.courierId).toBe(courierId(2));
    expect(renewed?.points[0]).toEqual(other.lastLocation);
    expect(await routes.findByOrder(order)).toEqual(renewed);
    expect(lines).toEqual([
      {
        level: 'info',
        message: 'siparis yeniden atandi; rota yenilendi',
        fields: { orderId: order, courierId: courierId(2), previousCourierId: courierId(1) },
      },
    ]);
  });

  it('AYNI kuryeye yeniden atandiysa (birak + ata, QA B2) rota yenilenir: saklanan rota son atamadan eski', async () => {
    const order = orderId();
    const first = await routeOf(
      request(order, courier(1, { lastLocation: away, lastAssignedAt: new Date(NOW_MS) })),
      recordingLogger(lines),
    );
    clockMs += 60_000;
    const moved = northOf(MARKET_LOCATION, 200);

    const again = await routeOf(
      request(order, courier(1, { lastLocation: moved, lastAssignedAt: new Date(clockMs) })),
      recordingLogger(lines),
    );

    expect(again).not.toEqual(first);
    expect(again).toMatchObject({ courierId: courierId(1), createdAt: new Date(clockMs) });
    expect(again?.points[0]).toEqual(moved);
    expect(await routes.findByOrder(order)).toEqual(again);
    expect(lines.map((line) => line.message)).toEqual(['siparis yeniden atandi; rota yenilendi']);
  });

  it('ayni atamanin tekrar istegi (rota son atamadan sonra uretilmis) yenilemez', async () => {
    const order = orderId();
    const holder = courier(1, { lastLocation: away, lastAssignedAt: new Date(NOW_MS) });
    const first = await routeOf(request(order, holder), recordingLogger(lines));
    clockMs += 60_000;

    expect(await routeOf(request(order, holder), recordingLogger(lines))).toEqual(first);
    expect(lines).toEqual([]);
  });

  it('market kopyada yoksa rota yok (null) ve WARN; hicbir sey yazilmaz', async () => {
    const order = orderId();

    const route = await routeOf(
      request(order, undefined, 'mkt_boyle-bir-market-yok'),
      recordingLogger(lines),
    );

    expect(route).toBeNull();
    expect(await routes.findByOrder(order)).toBeNull();
    expect(lines).toEqual([
      {
        level: 'warn',
        message: 'rota uretilemedi: market konumu bilinmiyor',
        fields: { orderId: order, marketId: 'mkt_boyle-bir-market-yok' },
      },
    ]);
  });

  it('ayni siparise eszamanli iki istek: tek rota yazilir, ikisi de onu gorur', async () => {
    const order = orderId();

    const [a, b] = await Promise.all([
      routeOf(request(order), recordingLogger(lines)),
      routeOf(request(order), recordingLogger(lines)),
    ]);

    expect(a).toEqual(b);
    expect(await routes.findByOrder(order)).toEqual(a);
  });
});
