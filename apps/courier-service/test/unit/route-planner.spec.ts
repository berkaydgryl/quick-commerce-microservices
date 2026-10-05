/**
 * Rota planlayici (T13.2, domain/route-planner.ts) ve buyuk daire araradegerleme
 * (domain/geo.ts). "Bitti sayilir": rota noktalari esit aralikli.
 *
 * Esit aralik her bacakta (kurye -> market, market -> adres) ayri olculur:
 * bacak icindeki ardisik iki nokta arasi mesafe milimetreden az sapar. Iki
 * bacagin araligi birbirine yakindir (parcalar uzunluk oraninda bolunur).
 */

import { describe, expect, it } from 'vitest';

import type { GeoPoint } from '../../src/domain/courier.js';
import { distanceMeters, greatCirclePoints } from '../../src/domain/geo.js';
import {
  etaSeconds,
  firstLegSegments,
  planRoute,
  routePointCount,
} from '../../src/domain/route-planner.js';
import { DELIVERY, MARKET_LOCATION, northOf, ROUTE_RULE } from '../support/couriers.js';

/** Bacak icindeki sapmanin ust siniri (m): slerp'te sapma nanometre duzeyinde. */
const SPACING_TOLERANCE_METERS = 0.001;

function gaps(points: readonly GeoPoint[]): number[] {
  return points.slice(1).map((point, index) => distanceMeters(points[index] ?? point, point));
}

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/** Kadikoy'de dogu-kuzeydogu yonunde uzak bir nokta (Moda'dan ~`km` km). */
const eastOf = (from: GeoPoint, km: number): GeoPoint => ({
  lat: from.lat + km * 0.004,
  lng: from.lng + km * 0.011,
});

describe('greatCirclePoints', () => {
  it('uclar birebir, ara noktalar esit aralikli ve toplam mesafe korunur', () => {
    const to = eastOf(MARKET_LOCATION, 3);

    const points = greatCirclePoints(MARKET_LOCATION, to, 25);

    expect(points).toHaveLength(26);
    expect(points[0]).toBe(MARKET_LOCATION);
    expect(points.at(-1)).toBe(to);
    const steps = gaps(points);
    expect(spread(steps)).toBeLessThan(SPACING_TOLERANCE_METERS);
    expect(steps.reduce((sum, step) => sum + step, 0)).toBeCloseTo(
      distanceMeters(MARKET_LOCATION, to),
      3,
    );
  });

  it('0 parca: yalnizca baslangic; ayni nokta: hep o nokta', () => {
    expect(greatCirclePoints(MARKET_LOCATION, DELIVERY, 0)).toEqual([MARKET_LOCATION]);
    expect(greatCirclePoints(MARKET_LOCATION, MARKET_LOCATION, 3)).toEqual([
      MARKET_LOCATION,
      MARKET_LOCATION,
      MARKET_LOCATION,
      MARKET_LOCATION,
    ]);
  });
});

describe('routePointCount / firstLegSegments / etaSeconds', () => {
  it('nokta sayisi ceil(toplam / 100), 20 ile 40 arasina kirpilir', () => {
    expect(routePointCount(0, ROUTE_RULE)).toBe(20);
    expect(routePointCount(1_999, ROUTE_RULE)).toBe(20);
    expect(routePointCount(2_001, ROUTE_RULE)).toBe(21);
    expect(routePointCount(3_050, ROUTE_RULE)).toBe(31);
    expect(routePointCount(4_000, ROUTE_RULE)).toBe(40);
    expect(routePointCount(25_000, ROUTE_RULE)).toBe(40);
  });

  it('parcalar bacaklara uzunluk oraninda; uzunlugu olan bacak en az bir parca, kurye marketteyse 0', () => {
    expect(firstLegSegments(1_000, 1_000, 19)).toBe(10);
    expect(firstLegSegments(500, 1_500, 19)).toBe(5);
    expect(firstLegSegments(10, 5_000, 39)).toBe(1);
    expect(firstLegSegments(5_000, 10, 39)).toBe(38);
    expect(firstLegSegments(0, 1_500, 19)).toBe(0);
    expect(firstLegSegments(1_500, 0, 19)).toBe(19);
  });

  it('ETA = ceil(toplam m / (km/sa / 3,6)) sn', () => {
    expect(etaSeconds(2_000, 20)).toBe(360);
    expect(etaSeconds(2_001, 20)).toBe(361);
    expect(etaSeconds(1_000, 36)).toBe(100);
    expect(etaSeconds(0, 20)).toBe(0);
  });
});

describe('planRoute: kurye -> market -> adres', () => {
  it('ilk nokta kurye, market noktasi birebir kose, son nokta adres; her bacakta esit aralik', () => {
    const from = northOf(MARKET_LOCATION, 600);

    const plan = planRoute({ from, pickup: MARKET_LOCATION, dropoff: DELIVERY }, ROUTE_RULE);

    const toPickup = distanceMeters(from, MARKET_LOCATION);
    const toDropoff = distanceMeters(MARKET_LOCATION, DELIVERY);
    expect(plan.points).toHaveLength(routePointCount(toPickup + toDropoff, ROUTE_RULE));
    expect(plan.points[0]).toBe(from);
    expect(plan.points[plan.pickupIndex]).toBe(MARKET_LOCATION);
    expect(plan.points.at(-1)).toBe(DELIVERY);
    const firstLeg = gaps(plan.points.slice(0, plan.pickupIndex + 1));
    const secondLeg = gaps(plan.points.slice(plan.pickupIndex));
    expect(firstLeg.length).toBeGreaterThan(0);
    expect(spread(firstLeg)).toBeLessThan(SPACING_TOLERANCE_METERS);
    expect(spread(secondLeg)).toBeLessThan(SPACING_TOLERANCE_METERS);
    expect(plan.distanceMeters).toBe(Math.round(toPickup + toDropoff));
    expect(plan.etaSeconds).toBe(etaSeconds(plan.distanceMeters, ROUTE_RULE.speedKmh));
  });

  it('uzun rota (8 km): 40 nokta, iki bacagin araligi birbirine yakin (en cok %25 fark)', () => {
    const from = eastOf(MARKET_LOCATION, 2);
    const dropoff = eastOf(MARKET_LOCATION, -6);

    const plan = planRoute({ from, pickup: MARKET_LOCATION, dropoff }, ROUTE_RULE);

    expect(plan.points).toHaveLength(40);
    const firstLeg = gaps(plan.points.slice(0, plan.pickupIndex + 1));
    const secondLeg = gaps(plan.points.slice(plan.pickupIndex));
    expect(spread(firstLeg)).toBeLessThan(SPACING_TOLERANCE_METERS);
    expect(spread(secondLeg)).toBeLessThan(SPACING_TOLERANCE_METERS);
    const [a = 0, b = 0] = [firstLeg[0], secondLeg[0]];
    expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.25);
  });

  it('kurye marketteyse ilk bacak yok: ilk nokta market, araliklar tek bacakta esit', () => {
    const plan = planRoute(
      { from: MARKET_LOCATION, pickup: MARKET_LOCATION, dropoff: DELIVERY },
      ROUTE_RULE,
    );

    expect(plan.pickupIndex).toBe(0);
    expect(plan.points[0]).toBe(MARKET_LOCATION);
    expect(plan.points).toHaveLength(20);
    expect(spread(gaps(plan.points))).toBeLessThan(SPACING_TOLERANCE_METERS);
  });

  it('adres marketin yerindeyse market son nokta; hepsi ayni yerse 20 ayni nokta, mesafe ve ETA 0', () => {
    const from = northOf(MARKET_LOCATION, 300);
    const atMarket = planRoute(
      { from, pickup: MARKET_LOCATION, dropoff: MARKET_LOCATION },
      ROUTE_RULE,
    );
    const still = planRoute(
      { from: MARKET_LOCATION, pickup: MARKET_LOCATION, dropoff: MARKET_LOCATION },
      ROUTE_RULE,
    );

    expect(atMarket.pickupIndex).toBe(atMarket.points.length - 1);
    expect(atMarket.points.at(-1)).toEqual(MARKET_LOCATION);
    expect(still.points).toEqual(Array.from({ length: 20 }, () => MARKET_LOCATION));
    expect(still).toMatchObject({ distanceMeters: 0, etaSeconds: 0, pickupIndex: 0 });
  });

  it('hiz ETA yi belirler: iki kat hiz yaklasik yari sure', () => {
    const legs = {
      from: northOf(MARKET_LOCATION, 400),
      pickup: MARKET_LOCATION,
      dropoff: DELIVERY,
    };

    const slow = planRoute(legs, ROUTE_RULE);
    const fast = planRoute(legs, { ...ROUTE_RULE, speedKmh: ROUTE_RULE.speedKmh * 2 });

    expect(fast.points).toEqual(slow.points);
    expect(fast.etaSeconds).toBe(etaSeconds(slow.distanceMeters, ROUTE_RULE.speedKmh * 2));
    expect(Math.abs(slow.etaSeconds - 2 * fast.etaSeconds)).toBeLessThanOrEqual(2);
  });

  it('ETA nin tek kaynagi yuvarlanmis mesafe (QA B4): 300 rotada istemci distance_meters tan ayni ETA yi bulur', () => {
    const mismatches: number[] = [];
    for (let index = 0; index < 300; index += 1) {
      const plan = planRoute(
        {
          from: northOf(MARKET_LOCATION, 37 * index + 0.31 * index),
          pickup: MARKET_LOCATION,
          dropoff: eastOf(MARKET_LOCATION, 0.5 + index / 97),
        },
        ROUTE_RULE,
      );
      if (plan.etaSeconds !== etaSeconds(plan.distanceMeters, ROUTE_RULE.speedKmh)) {
        mismatches.push(index);
      }
    }

    expect(mismatches).toEqual([]);
  });
});
