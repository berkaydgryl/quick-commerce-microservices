/**
 * Rotada ilerleme (T13.3): zamandan konum, asama ve kalanlar. Saf fonksiyon;
 * an parametredir (saat yok). Rota planlayicinin gercek ciktisi uzerinde.
 */

import { describe, expect, it } from 'vitest';

import { distanceMeters } from '../../src/domain/geo.js';
import type { Route } from '../../src/domain/route.js';
import { planRoute } from '../../src/domain/route-planner.js';
import {
  pointAlong,
  polylineMeters,
  routeProgress,
  routeSchedule,
  TRACKING_PHASE,
} from '../../src/domain/route-progress.js';

const START = new Date('2026-10-07T12:00:00.000Z');
const SPEED_KMH = 36; // 10 m/sn: hesaplar okunur kalsin
const RULE = { speedKmh: SPEED_KMH, prepSeconds: 30 };
const PLAN_RULE = { spacingMeters: 100, minPoints: 20, maxPoints: 40, speedKmh: SPEED_KMH };

const COURIER = { lat: 40.995, lng: 29.025 };
const MARKET = { lat: 40.985, lng: 29.0275 };
const ADDRESS = { lat: 40.9885, lng: 29.0262 };

function route(from = COURIER, pickup = MARKET, dropoff = ADDRESS): Route {
  return {
    orderId: 'ord_0123456789abcdef0123456789abcdef',
    courierId: 'crr_0123456789abcdef0123456789abcdef',
    ...planRoute({ from, pickup, dropoff }, PLAN_RULE),
    createdAt: START,
  };
}

const after = (seconds: number) => new Date(START.getTime() + Math.round(seconds * 1_000));

describe('routeSchedule', () => {
  it('iki bacak market noktasinda birlesir; alma ani max(1. bacak / hiz, hazirlik)', () => {
    const subject = route();
    const schedule = routeSchedule(subject, RULE);

    expect(schedule.legOneMeters).toBeCloseTo(distanceMeters(COURIER, MARKET), 0);
    expect(schedule.legTwoMeters).toBeCloseTo(distanceMeters(MARKET, ADDRESS), 0);
    expect(schedule.legOneMeters + schedule.legTwoMeters).toBeCloseTo(subject.distanceMeters, 0);
    // 1. bacak ~1140 m / 10 m/sn = ~114 sn > 30 sn hazirlik: kurye beklemez.
    expect(schedule.pickupSeconds).toBeCloseTo(schedule.legOneMeters / 10, 6);
    expect(schedule.arrivalSeconds).toBeCloseTo(
      schedule.pickupSeconds + schedule.legTwoMeters / 10,
      6,
    );
  });

  it('kurye hazirliktan once varirsa markette bekler: alma ani hazirlik suresi', () => {
    const schedule = routeSchedule(route(), { speedKmh: SPEED_KMH, prepSeconds: 600 });

    expect(schedule.pickupSeconds).toBe(600);
  });
});

describe('routeProgress', () => {
  const subject = route();
  const schedule = routeSchedule(subject, RULE);

  it('baslangicta TO_MARKET, kuryenin atama konumunda; kalan yol yalnizca 2. bacak', () => {
    const progress = routeProgress(subject, START, RULE);

    expect(progress.phase).toBe(TRACKING_PHASE.TO_MARKET);
    expect(progress.position).toEqual(COURIER);
    expect(progress.legTwoRemainingMeters).toBe(Math.round(schedule.legTwoMeters));
    expect(progress.etaSeconds).toBe(Math.ceil(schedule.arrivalSeconds));
    expect(progress.pickedUpAt).toBeUndefined();
  });

  it('1. bacakta MESAFEYLE ilerler (QA B3): 50 sn sonra 500 m yol alinmis', () => {
    const progress = routeProgress(subject, after(50), RULE);
    const { legOne } = { legOne: subject.points.slice(0, subject.pickupIndex + 1) };

    expect(progress.phase).toBe(TRACKING_PHASE.TO_MARKET);
    expect(distanceMeters(progress.position, pointAlong(legOne, 500))).toBeLessThan(0.01);
    expect(distanceMeters(COURIER, progress.position)).toBeCloseTo(500, -1);
  });

  it('alma aninda TO_CUSTOMER; alma ani rotanin anindan hesaplanir', () => {
    const progress = routeProgress(subject, after(schedule.pickupSeconds), RULE);

    expect(progress.phase).toBe(TRACKING_PHASE.TO_CUSTOMER);
    expect(distanceMeters(progress.position, MARKET)).toBeLessThan(0.01);
    expect(progress.pickedUpAt?.getTime()).toBe(
      START.getTime() + Math.round(schedule.pickupSeconds * 1_000),
    );
    expect(progress.deliveredAt).toBeUndefined();
  });

  it('2. bacakta kalan yol ve sure azalir', () => {
    const progress = routeProgress(subject, after(schedule.pickupSeconds + 20), RULE);

    expect(progress.phase).toBe(TRACKING_PHASE.TO_CUSTOMER);
    expect(progress.legTwoRemainingMeters).toBe(Math.round(schedule.legTwoMeters - 200));
    expect(progress.etaSeconds).toBe(
      Math.ceil(schedule.arrivalSeconds - (schedule.pickupSeconds + 20)),
    );
  });

  it('varista DELIVERED: konum adres, kalanlar 0, iki an da var', () => {
    const progress = routeProgress(subject, after(schedule.arrivalSeconds + 5), RULE);

    expect(progress.phase).toBe(TRACKING_PHASE.DELIVERED);
    expect(progress.position).toEqual(ADDRESS);
    expect(progress.legTwoRemainingMeters).toBe(0);
    expect(progress.etaSeconds).toBe(0);
    expect(progress.deliveredAt?.getTime()).toBe(
      START.getTime() + Math.round(schedule.arrivalSeconds * 1_000),
    );
  });

  it('markette beklerken konum market, asama TO_MARKET', () => {
    const slowPrep = { speedKmh: SPEED_KMH, prepSeconds: 600 };
    const progress = routeProgress(subject, after(300), slowPrep);

    expect(progress.phase).toBe(TRACKING_PHASE.TO_MARKET);
    expect(distanceMeters(progress.position, MARKET)).toBeLessThan(0.01);
  });

  it('kurye marketteyse 1. bacak yok; adres marketin kendisiyse varis alma aninda', () => {
    const atMarket = route(MARKET, MARKET, ADDRESS);
    expect(atMarket.pickupIndex).toBe(0);
    expect(routeProgress(atMarket, after(30), RULE).phase).toBe(TRACKING_PHASE.TO_CUSTOMER);

    const sameSpot = route(COURIER, MARKET, MARKET);
    const schedule2 = routeSchedule(sameSpot, RULE);
    expect(schedule2.legTwoMeters).toBe(0);
    expect(schedule2.arrivalSeconds).toBe(schedule2.pickupSeconds);
    expect(routeProgress(sameSpot, after(schedule2.pickupSeconds), RULE).phase).toBe(
      TRACKING_PHASE.DELIVERED,
    );
  });

  it('rotanin anindan once sorulursa baslangic sayilir', () => {
    expect(routeProgress(subject, after(-10), RULE).position).toEqual(COURIER);
  });
});

describe('pointAlong ve polylineMeters', () => {
  it('uclar ve bas/son; yol bitince son nokta', () => {
    const line = [MARKET, ADDRESS];
    const length = polylineMeters(line);

    expect(pointAlong(line, 0)).toEqual(MARKET);
    expect(pointAlong(line, length + 100)).toEqual(ADDRESS);
    expect(pointAlong(line, -5)).toEqual(MARKET);
    expect(() => pointAlong([], 10)).toThrow();
  });
});
