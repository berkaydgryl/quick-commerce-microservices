/**
 * Iptal (ReleaseCourier) ile teslim (tick) yarisi (#177) ve iptalde kuryenin
 * yerinde birakilmasi (#174). Yaris DETERMINISTIK: sahte depo iki islemin
 * arasina digerini sokar. Her senaryoda TEK sonuc kalir: ya teslim (olay var,
 * kurye teslimat noktasinda, rota DONE) ya iptal (olay yok, kurye rotadaki
 * hesaplanan konumda, rota ENDED).
 */

import { fixedClock, silentLogger } from '@getir/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAdvanceRoute } from '../../src/application/advance-route.js';
import { createReleaseCourier } from '../../src/application/release-courier.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import { ROUTE_STATE } from '../../src/domain/route.js';
import type { Route, RoutePatch } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import { routeProgress, routeSchedule } from '../../src/domain/route-progress.js';
import { InMemoryCourierStore } from '../../src/infrastructure/memory/in-memory-courier-store.js';
import { InMemoryLiveLocationStore } from '../../src/infrastructure/memory/in-memory-live-location.js';
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
import { RecordingRouteEvents } from '../support/recording-route-events.js';

const RULE = { speedKmh: 36, prepSeconds: 30 };
const ASSIGNED_AT = northOf(MARKET_LOCATION, 600);

/** Sonraki ENDED yamasindan ONCE bir kez calisan kanca: iki islemin arasi. */
class RacingRouteStore extends InMemoryRouteStore {
  private between: (() => Promise<void>) | undefined;

  beforeNextEnd(hook: () => Promise<void>): void {
    this.between = hook;
  }

  override async update(route: Route, patch: RoutePatch): Promise<Route | null> {
    const hook = this.between;
    if (patch.state === ROUTE_STATE.ENDED && hook !== undefined) {
      this.between = undefined;
      await hook();
    }
    return super.update(route, patch);
  }
}

let clock: ReturnType<typeof fixedClock>;
let couriers: InMemoryCourierStore;
let routes: RacingRouteStore;
let events: RecordingRouteEvents;
let order: string;
let route: Route;

const release = () =>
  createReleaseCourier({ couriers, routes, rule: RULE, clock })(order, silentLogger);
const tick = (current: Route) =>
  createAdvanceRoute({
    routes,
    couriers,
    events,
    live: new InMemoryLiveLocationStore(),
    rule: RULE,
    clock,
  })(current, { ...courier(1), status: COURIER_STATUS.BUSY, currentOrderId: order }, silentLogger);
const arrivalMs = () => NOW_MS + Math.round(routeSchedule(route, RULE).arrivalSeconds * 1_000);
const carrier = () => couriers.findById(courierId(1));
const stored = async () => (await routes.findByOrder(order)) ?? route;

beforeEach(async () => {
  clock = fixedClock(NOW_MS);
  order = orderId();
  couriers = new InMemoryCourierStore([
    courier(1, {
      status: COURIER_STATUS.BUSY,
      currentOrderId: order,
      lastLocation: ASSIGNED_AT,
      lastAssignedAt: new Date(NOW_MS),
    }),
  ]);
  routes = new RacingRouteStore();
  events = new RecordingRouteEvents();
  route = await routes.insertOnce({
    orderId: order,
    courierId: courierId(1),
    ...planRoute({ from: ASSIGNED_AT, pickup: MARKET_LOCATION, dropoff: DELIVERY }, ROUTE_RULE),
    createdAt: new Date(NOW_MS),
    marketId: MARKET,
    movement: RULE,
    state: ROUTE_STATE.MOVING,
  });
});

describe('iptalde kurye yerinde birakilir (#174)', () => {
  it('kurye birakma anindaki HESAPLANAN konumda IDLE olur: atandigi yere isinlanmaz', async () => {
    clock.set(NOW_MS + 30_000);
    const expected = routeProgress(route, clock.date(), RULE).position;

    expect(await release()).toEqual({ released: true, courierId: courierId(1) });

    const released = await carrier();
    expect(released).toMatchObject({
      status: COURIER_STATUS.IDLE,
      lastLocation: expected,
      lastLocationAt: clock.date(),
    });
    expect(released?.lastLocation).not.toEqual(ASSIGNED_AT);
    expect(released?.lastLocation).not.toEqual(MARKET_LOCATION);
    expect(await stored()).toMatchObject({ state: ROUTE_STATE.ENDED, endedAt: clock.date() });
  });
});

describe('iptalde birakma konumu kurallari (#174 S3-S5)', () => {
  it('S3: rota bu atamanin degilse (ayni kuryeye yeniden atama) konum DEGISMEZ', async () => {
    // Kurye ayni siparisi rotadan SONRA yeniden aldi: saklanan rota eski atamanin.
    await couriers.replaceAll(
      [
        courier(1, {
          status: COURIER_STATUS.BUSY,
          currentOrderId: order,
          lastLocation: ASSIGNED_AT,
          lastAssignedAt: new Date(NOW_MS + 10_000),
        }),
      ],
      [],
    );
    clock.set(NOW_MS + 30_000);

    expect((await release()).released).toBe(true);

    expect((await carrier())?.lastLocation).toEqual(ASSIGNED_AT);
    expect((await stored()).state).toBe(ROUTE_STATE.MOVING);
  });

  it('S3: rota baska kuryenin ise konum DEGISMEZ', async () => {
    await routes.replace({ ...route, courierId: courierId(2) });
    clock.set(NOW_MS + 30_000);

    expect((await release()).released).toBe(true);

    expect((await carrier())?.lastLocation).toEqual(ASSIGNED_AT);
  });

  it('S4: hesap teslimi gecti ama tick yazmadi: iptal kazanir, kurye ADRESTE bosa cikar', async () => {
    clock.set(arrivalMs() + 2_000);

    expect((await release()).released).toBe(true);

    expect((await carrier())?.lastLocation).toEqual(DELIVERY);
    expect((await stored()).deliveredAt).toBeUndefined();
  });

  it('S5: kayitli alma var, saat kaydin gerisinde (hesap TO_MARKET): MARKET noktasi, birinci bacak degil', async () => {
    const pickedUpAt = new Date(
      NOW_MS + Math.round(routeSchedule(route, RULE).pickupSeconds * 1_000) - 30_000,
    );
    route = (await routes.update(route, { pickedUpAt, pickupPublished: true })) ?? route;
    clock.set(pickedUpAt.getTime() - 10_000);
    expect(routeProgress(route, clock.date(), RULE).phase).toBe('TO_MARKET');

    expect((await release()).released).toBe(true);

    expect((await carrier())?.lastLocation).toEqual(MARKET_LOCATION);
  });

  it('onceki deneme ENDED yazdi, birakma dustu: tekrar cagri kuryeyi BITIS ANINDAKI konumda birakir', async () => {
    const endedAt = new Date(NOW_MS + 30_000);
    await routes.update(route, { state: ROUTE_STATE.ENDED, endedAt });
    clock.set(NOW_MS + 90_000);

    expect((await release()).released).toBe(true);

    expect((await carrier())?.lastLocation).toEqual(routeProgress(route, endedAt, RULE).position);
  });
});

describe('iptal ile teslim yarisi: tek sonuc (#177)', () => {
  it('iptal rotayi okuduktan sonra tick teslimi kaydederse TESLIM kazanir: kurye birakilmaz, tick yayinlar', async () => {
    clock.set(arrivalMs() + 1_000);
    const deliveredAt = new Date(arrivalMs());
    routes.beforeNextEnd(async () => {
      await routes.update(route, { deliveredAt });
    });

    expect(await release()).toEqual({ released: false });
    expect(await carrier()).toMatchObject({ status: COURIER_STATUS.BUSY, currentOrderId: order });
    expect((await stored()).state).toBe(ROUTE_STATE.MOVING);

    await tick(await stored());

    expect(events.published.filter((event) => event.type === 'delivered')).toHaveLength(1);
    expect(await stored()).toMatchObject({ state: ROUTE_STATE.DONE, deliveredAt });
    expect(await carrier()).toMatchObject({ status: COURIER_STATUS.IDLE, lastLocation: DELIVERY });
  });

  it('tick rotayi okuduktan sonra iptal ENDED yazarsa IPTAL kazanir: teslim yazilmaz, olay yok, kurye yerinde', async () => {
    const staleRead = await stored();
    clock.set(arrivalMs() - 5_000);
    const expected = routeProgress(route, clock.date(), RULE).position;

    expect((await release()).released).toBe(true);
    clock.set(arrivalMs() + 1_000);
    await tick(staleRead);

    expect(events.published.filter((event) => event.type === 'delivered')).toEqual([]);
    expect(await stored()).toMatchObject({ state: ROUTE_STATE.ENDED });
    expect((await stored()).deliveredAt).toBeUndefined();
    expect(await carrier()).toMatchObject({ status: COURIER_STATUS.IDLE, lastLocation: expected });
    expect((await carrier())?.lastLocation).not.toEqual(DELIVERY);
  });

  it('teslimi kaydedilmis rotaya iptal ENDED YAZAMAZ: depo kosulu (bellek; Mongo sozlesmede)', async () => {
    await routes.update(route, { deliveredAt: new Date(NOW_MS + 60_000) });

    expect(
      await routes.update(route, { state: ROUTE_STATE.ENDED, endedAt: clock.date() }),
    ).toBeNull();
    expect((await stored()).state).toBe(ROUTE_STATE.MOVING);
  });

  it('teslim yayini once dustu, rota sonra yenilendi: bayat rotayla teslim YAYINLANMAZ (yayin kosullu yamaya bagli)', async () => {
    clock.set(arrivalMs() + 1_000);
    events.failNext('delivered');
    await expect(tick(route)).rejects.toThrow('hat yazilamadi');
    const stale = await stored();
    expect(stale.deliveredAt).toBeDefined();
    // Siparis baska kuryeye yeniden atandi: rota yenisiyle degisti.
    const { deliveredAt: _recorded, ...renewed } = stale;
    await routes.replace({ ...renewed, courierId: courierId(2), createdAt: new Date(clock.now()) });

    await tick(stale);

    expect(events.published.filter((event) => event.type === 'delivered')).toEqual([]);
  });
});
