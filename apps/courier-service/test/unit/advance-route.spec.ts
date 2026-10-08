/**
 * Tick'in rota adimi (T13.3): kilometre taslari BIR KEZ kaydedilir, olay en az
 * bir kez yayinlanir, kurye teslimat noktasinda bosa cikar; birakilan ya da
 * yenilenen rota ilerlemez. Bellek depolari, sabit saat.
 */

import { fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ADVANCE_OUTCOME, createAdvanceRoute } from '../../src/application/advance-route.js';
import { COURIER_STATUS } from '../../src/domain/courier.js';
import { ROUTE_STATE } from '../../src/domain/route.js';
import type { Route } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import { routeSchedule } from '../../src/domain/route-progress.js';
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

let clock: ReturnType<typeof fixedClock>;
let couriers: InMemoryCourierStore;
let routes: InMemoryRouteStore;
let events: RecordingRouteEvents;
let live: InMemoryLiveLocationStore;
let lines: LogLine[];
let order: string;
let route: Route;

function advance() {
  return createAdvanceRoute({ routes, couriers, events, live, rule: RULE, clock });
}

/** Ilerleyen rotanin saklanan son hali (tick her turda depodan okur). */
async function stored(): Promise<Route> {
  const current = await routes.findByOrder(order);
  if (current === null) {
    throw new Error('rota yok');
  }
  return current;
}

/** Bir tur adimi: tick gibi rotanin kuryesinin o anki kaydiyla. */
const step = async () => {
  const current = await stored();
  return advance()(current, await couriers.findById(current.courierId), recordingLogger(lines));
};

beforeEach(async () => {
  clock = fixedClock(NOW_MS);
  order = orderId();
  couriers = new InMemoryCourierStore([
    courier(1, {
      status: COURIER_STATUS.BUSY,
      currentOrderId: order,
      lastAssignedAt: new Date(NOW_MS),
    }),
  ]);
  routes = new InMemoryRouteStore();
  events = new RecordingRouteEvents();
  live = new InMemoryLiveLocationStore();
  lines = [];
  route = await routes.insertOnce({
    orderId: order,
    courierId: courierId(1),
    ...planRoute(
      { from: northOf(MARKET_LOCATION, 600), pickup: MARKET_LOCATION, dropoff: DELIVERY },
      ROUTE_RULE,
    ),
    createdAt: new Date(NOW_MS),
    marketId: MARKET,
    state: ROUTE_STATE.MOVING,
  });
});

describe('createAdvanceRoute', () => {
  it('yolda: olay yok, canli konum yazilir', async () => {
    clock.advance(10_000);

    expect(await step()).toBe(ADVANCE_OUTCOME.MOVING);
    expect(events.published).toEqual([]);
    expect((await live.find(courierId(1)))?.at).toEqual(clock.date());
  });

  it('alma aninda: pickedUpAt BIR KEZ kaydedilir, courier.picked_up market ve anla yayinlanir; ikinci tur tekrar yayinlamaz', async () => {
    const schedule = routeSchedule(route, RULE);
    clock.advance(Math.ceil(schedule.pickupSeconds * 1_000) + 1_000);

    expect(await step()).toBe(ADVANCE_OUTCOME.PICKED_UP);
    const after = await stored();
    expect(after.pickedUpAt).toEqual(new Date(NOW_MS + Math.round(schedule.pickupSeconds * 1_000)));
    expect(after.pickupPublished).toBe(true);
    expect(events.published).toEqual([
      {
        type: 'picked_up',
        orderId: order,
        courierId: courierId(1),
        marketId: MARKET,
        at: after.pickedUpAt,
      },
    ]);

    clock.advance(2_000);
    expect(await step()).toBe(ADVANCE_OUTCOME.MOVING);
    expect(events.published).toHaveLength(1);
  });

  it('varista: kurye TESLIMAT NOKTASINDA bosa cikar, courier.delivered yayinlanir, rota DONE ve listeden cikar', async () => {
    const schedule = routeSchedule(route, RULE);
    clock.advance(Math.ceil(schedule.arrivalSeconds * 1_000) + 5_000);

    expect(await step()).toBe(ADVANCE_OUTCOME.DELIVERED);
    const deliveredAt = new Date(NOW_MS + Math.round(schedule.arrivalSeconds * 1_000));
    expect(events.published.map((event) => event.type)).toEqual(['picked_up', 'delivered']);
    expect(events.published[1]?.at).toEqual(deliveredAt);
    expect(await stored()).toMatchObject({
      state: ROUTE_STATE.DONE,
      deliveredAt,
      deliveryPublished: true,
    });
    expect(await routes.listMoving(10)).toEqual([]);
    const freed = await couriers.findById(courierId(1));
    expect(freed?.status).toBe(COURIER_STATUS.IDLE);
    expect(freed?.lastLocation).toEqual(DELIVERY);
    expect(freed?.idleSince).toEqual(deliveredAt);
  });

  it('hiz ayari yol ortasinda hizlanirsa ikinci bacak KAYITLI almadan baslar (#195): once yolda, sonra teslim = alma + 2. bacak / yeni hiz', async () => {
    const slow = { speedKmh: 6, prepSeconds: 600 };
    const fast = { speedKmh: 120, prepSeconds: 0 };
    const stepWith = async (rule: typeof RULE) => {
      const current = await stored();
      return createAdvanceRoute({ routes, couriers, events, live, rule, clock })(
        current,
        await couriers.findById(current.courierId),
        recordingLogger(lines),
      );
    };
    // On kosul (fikstur geometrisi): yavas ayarla alma 600. sn; yeni (hizli) ayarin
    // cizelgesi teslimi cok once koyardi (eskiden ikinci bacak sifir saniye surerdi).
    expect(routeSchedule(route, slow).pickupSeconds).toBe(600);
    expect(routeSchedule(route, fast).arrivalSeconds).toBeLessThan(600);
    const legTwoMs = Math.round(routeSchedule(route, fast).legTwoSeconds * 1_000);
    expect(legTwoMs).toBeGreaterThan(2);
    const pickedUpAt = new Date(NOW_MS + 600_000);

    clock.set(NOW_MS + 600_001);
    expect(await stepWith(slow)).toBe(ADVANCE_OUTCOME.PICKED_UP);
    expect((await stored()).pickedUpAt).toEqual(pickedUpAt);

    // Yeni ayarla ikinci bacagin ortasi: hala yolda, teslim yazilmaz.
    clock.set(pickedUpAt.getTime() + Math.floor(legTwoMs / 2));
    expect(await stepWith(fast)).toBe(ADVANCE_OUTCOME.MOVING);
    expect((await stored()).deliveredAt).toBeUndefined();

    clock.set(pickedUpAt.getTime() + legTwoMs);
    expect(await stepWith(fast)).toBe(ADVANCE_OUTCOME.DELIVERED);
    const deliveredAt = new Date(pickedUpAt.getTime() + legTwoMs);
    expect(await stored()).toMatchObject({ state: ROUTE_STATE.DONE, pickedUpAt, deliveredAt });
    expect(events.published.at(-1)).toMatchObject({ type: 'delivered', at: deliveredAt });
    expect((await couriers.findById(courierId(1)))?.idleSince).toEqual(deliveredAt);
  });

  it('EN AZ BIR KEZ: teslimat yayini duserse sonraki tur yayinlar; kurye bir kez birakilir', async () => {
    clock.advance(3_600_000);
    events.failNext('picked_up');

    await expect(step()).rejects.toThrow('hat yazilamadi');
    const half = await stored();
    expect(half.pickedUpAt).toBeDefined();
    expect(half.pickupPublished).toBeUndefined();

    events.failNext('delivered');
    await expect(step()).rejects.toThrow('hat yazilamadi');
    const recorded = await stored();
    expect(recorded.deliveredAt).toBeDefined();
    expect(recorded.deliveryPublished).toBeUndefined();
    expect((await couriers.findById(courierId(1)))?.status).toBe(COURIER_STATUS.IDLE);

    expect(await step()).toBe(ADVANCE_OUTCOME.DELIVERED);
    expect(events.published.map((event) => event.type)).toEqual(['picked_up', 'delivered']);
    expect((await stored()).state).toBe(ROUTE_STATE.DONE);
  });

  it('kurye siparisi artik tasimiyorsa (iptal) rota ENDED: olay ve canli konum yok', async () => {
    await couriers.releaseByOrder(order, new Date(NOW_MS + 5_000));
    clock.advance(3_600_000);

    expect(await step()).toBe(ADVANCE_OUTCOME.ENDED);
    expect(await stored()).toMatchObject({ state: ROUTE_STATE.ENDED, endedAt: clock.date() });
    expect(events.published).toEqual([]);
    expect(await live.find(courierId(1))).toBeNull();
  });

  it('rota yeniden atamayla yenilendiyse eski rota nesnesi STALE: hicbir sey yazilmaz', async () => {
    const stale = await stored();
    await couriers.releaseByOrder(order, new Date(NOW_MS + 5_000));
    await routes.replace({
      ...stale,
      courierId: courierId(2),
      createdAt: new Date(NOW_MS + 60_000),
    });
    clock.advance(3_600_000);

    expect(
      await advance()(stale, await couriers.findById(stale.courierId), recordingLogger(lines)),
    ).toBe(ADVANCE_OUTCOME.STALE);
    expect(events.published).toEqual([]);
    expect((await stored()).courierId).toBe(courierId(2));
  });

  it('kurye kimligiyle birakma: teslimi kaydedilmis bayat rota, siparis BASKA kuryedeyken onu birakmaz', async () => {
    clock.advance(3_600_000);
    events.failNext('delivered');
    await expect(step()).rejects.toThrow('hat yazilamadi');
    const stale = await stored();
    expect(stale.deliveredAt).toBeDefined();
    // Ayni tur icinde siparis kurye 2'ye gecti; rota nesnesi henuz eski.
    const holder = courier(2, { status: COURIER_STATUS.BUSY, currentOrderId: order });
    couriers = new InMemoryCourierStore([courier(1), holder]);

    expect(
      await advance()(stale, await couriers.findById(courierId(1)), recordingLogger(lines)),
    ).toBe(ADVANCE_OUTCOME.DELIVERED);
    expect(await couriers.findById(courierId(2))).toEqual(holder);
  });

  it('T13.3 oncesi rota (market yok): picked_up atlanir, isaret yazilir; delivered yine yayinlanir', async () => {
    const { marketId: _market, state: _state, ...legacy } = await stored();
    await routes.replace(legacy);
    clock.advance(3_600_000);

    expect(await step()).toBe(ADVANCE_OUTCOME.DELIVERED);
    expect(events.published.map((event) => event.type)).toEqual(['delivered']);
    expect(await stored()).toMatchObject({ pickupPublished: true, state: ROUTE_STATE.DONE });
  });
});
