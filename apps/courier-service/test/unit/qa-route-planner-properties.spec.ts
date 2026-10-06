/**
 * QA kara kutu (T13.2 PR 3, #124; QA Q8): rota planlayicinin ozellikleri,
 * sabit tohumla uretilen 20.000 gercekci rota ve uc cografya uzerinde.
 * Backend'in testleri secilmis orneklerle (ve B4 icin 300 rotayla) sinar;
 * burada her rotada AYNI kurallar:
 *
 *   - nokta sayisi clamp(ceil(toplam m / 100), 20, 40)
 *   - ilk nokta kurye, pickupIndex'teki nokta market, son nokta adres (birebir)
 *   - her bacakta araliklar esit (QA B3 (a): esitlik BACAK ICINDE)
 *   - parcalarin toplami yuvarlanmis mesafeyle tutarli
 *   - ETA = ceil(distance_meters / (hiz / 3,6)): istemci distance_meters'tan
 *     ayni ETA'yi bulur (QA B4 (a)), butun hizlarda (1-120 km/sa)
 *   - kutup ve antimeridyende sayi disi koordinat yok
 */

import { describe, expect, it } from 'vitest';

import {
  COURIER_SPEED_KMH_MAX,
  COURIER_SPEED_KMH_MIN,
  ROUTE_MAX_POINTS,
  ROUTE_MIN_POINTS,
  ROUTE_POINT_SPACING_METERS,
} from '../../src/config/constants.js';
import type { GeoPoint } from '../../src/domain/courier.js';
import { distanceMeters } from '../../src/domain/geo.js';
import { planRoute } from '../../src/domain/route-planner.js';
import type { RoutePlan, RouteRule } from '../../src/domain/route-planner.js';
import { MARKET_LOCATION, northOf } from '../support/couriers.js';

const ROUTES = 20_000;
const SEED = 20_261_005;
/** Bacak ici araliklarin en buyuk goreli farki (kayan nokta payi). */
const SPACING_TOLERANCE = 1e-6;
const METERS_PER_DEGREE = 111_320;

/** mulberry32: tohumdan tekrarlanabilir [0, 1). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** `from`'dan `bearing` yonunde yaklasik `meters` (kisa mesafe). */
function offset(from: GeoPoint, meters: number, bearing: number): GeoPoint {
  const lat = from.lat + (meters * Math.cos(bearing)) / METERS_PER_DEGREE;
  const lng =
    from.lng +
    (meters * Math.sin(bearing)) / (METERS_PER_DEGREE * Math.cos((from.lat * Math.PI) / 180));
  return { lat, lng };
}

function rule(speedKmh: number): RouteRule {
  return {
    spacingMeters: ROUTE_POINT_SPACING_METERS,
    minPoints: ROUTE_MIN_POINTS,
    maxPoints: ROUTE_MAX_POINTS,
    speedKmh,
  };
}

function gaps(points: readonly GeoPoint[]): number[] {
  return points.slice(1).map((point, index) => distanceMeters(points[index] ?? point, point));
}

function spread(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const largest = Math.max(...values);
  return largest === 0 ? 0 : (largest - Math.min(...values)) / largest;
}

/** Bir rotanin kural ihlalleri (bos = uygun). */
function violations(
  legs: { from: GeoPoint; pickup: GeoPoint; dropoff: GeoPoint },
  plan: RoutePlan,
  speedKmh: number,
): string[] {
  const problems: string[] = [];
  const total = distanceMeters(legs.from, legs.pickup) + distanceMeters(legs.pickup, legs.dropoff);
  const expectedCount = Math.min(
    ROUTE_MAX_POINTS,
    Math.max(ROUTE_MIN_POINTS, Math.ceil(total / ROUTE_POINT_SPACING_METERS)),
  );
  const points = plan.points;
  if (points.length !== expectedCount)
    problems.push(`nokta ${points.length}, beklenen ${expectedCount}`);
  const sameAs = (point: GeoPoint | undefined, target: GeoPoint) =>
    point?.lat === target.lat && point.lng === target.lng;
  if (plan.pickupIndex > 0 && !sameAs(points[0], legs.from)) problems.push('ilk nokta kurye degil');
  if (!sameAs(points[plan.pickupIndex], legs.pickup)) problems.push('market kose degil');
  if (!sameAs(points.at(-1), legs.dropoff)) problems.push('son nokta adres degil');
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.lat) ||
        !Number.isFinite(p.lng) ||
        Math.abs(p.lat) > 90 ||
        Math.abs(p.lng) > 180,
    )
  ) {
    problems.push('gecersiz koordinat');
  }
  const segments = gaps(points);
  const firstLeg = segments.slice(0, plan.pickupIndex);
  const secondLeg = segments.slice(plan.pickupIndex);
  if (spread(firstLeg) > SPACING_TOLERANCE)
    problems.push(`ilk bacak araligi esit degil (${spread(firstLeg)})`);
  if (spread(secondLeg) > SPACING_TOLERANCE)
    problems.push(`ikinci bacak araligi esit degil (${spread(secondLeg)})`);
  const walked = segments.reduce((sum, gap) => sum + gap, 0);
  if (Math.abs(walked - plan.distanceMeters) > 0.5 + 1e-6)
    problems.push(`yol ${walked}, distance ${plan.distanceMeters}`);
  if (!Number.isInteger(plan.distanceMeters) || !Number.isInteger(plan.etaSeconds))
    problems.push('tam sayi degil');
  const clientEta = Math.ceil((plan.distanceMeters * 3_600) / (speedKmh * 1_000));
  if (plan.etaSeconds !== clientEta)
    problems.push(`eta ${plan.etaSeconds}, distance'tan ${clientEta}`);
  return problems;
}

describe('QA rota planlayicinin ozellikleri (#124, Q8)', () => {
  it(`sabit tohumla ${ROUTES} gercekci rota (kurye <= 3 km, adres <= 6 km, hiz 1-120): her rotada butun kurallar`, () => {
    const next = random(SEED);
    const failures: string[] = [];
    let longerThanMax = 0;
    let courierAtMarket = 0;
    for (let index = 0; index < ROUTES; index += 1) {
      const pickup = MARKET_LOCATION;
      // Rotalarin %5'inde kurye tam markette (ilk bacak yok).
      const from = next() < 0.05 ? pickup : offset(pickup, next() * 3_000, next() * 2 * Math.PI);
      const dropoff = offset(pickup, next() * 6_000, next() * 2 * Math.PI);
      const speed =
        COURIER_SPEED_KMH_MIN +
        Math.floor(next() * (COURIER_SPEED_KMH_MAX - COURIER_SPEED_KMH_MIN + 1));
      const plan = planRoute({ from, pickup, dropoff }, rule(speed));
      if (plan.points.length === ROUTE_MAX_POINTS) longerThanMax += 1;
      if (plan.pickupIndex === 0) courierAtMarket += 1;
      const problems = violations({ from, pickup, dropoff }, plan, speed);
      if (problems.length > 0 && failures.length < 5)
        failures.push(`#${index}: ${problems.join('; ')}`);
    }

    expect(failures).toEqual([]);
    // Ornek uzayinin iki ucu da gercekten denendi.
    expect(longerThanMax).toBeGreaterThan(1_000);
    expect(courierAtMarket).toBeGreaterThan(500);
  });

  it('cok kisa ilk bacak (kurye marketten 1 cm): market yine kose, araliklar bacak icinde esit (B3: bacaklar arasi farkli olabilir)', () => {
    const from = northOf(MARKET_LOCATION, 0.01);
    const dropoff = northOf(MARKET_LOCATION, -3_000);
    const plan = planRoute({ from, pickup: MARKET_LOCATION, dropoff }, rule(20));
    const segments = gaps(plan.points);

    expect(violations({ from, pickup: MARKET_LOCATION, dropoff }, plan, 20)).toEqual([]);
    expect(plan.pickupIndex).toBe(1);
    expect(segments[0]).toBeLessThan(0.02);
    expect(segments[1]).toBeGreaterThan(90);
  });

  it('uc cografya: kutup yakini ve antimeridyen; sayi disi koordinat yok, kurallar gecerli', () => {
    const cases: [string, GeoPoint, GeoPoint, GeoPoint][] = [
      [
        'antimeridyen',
        { lat: 0, lng: 179.99 },
        { lat: 0, lng: -179.99 },
        { lat: 0.01, lng: -179.98 },
      ],
      [
        'kuzey kutbu',
        { lat: 89.999, lng: 0 },
        { lat: 89.9995, lng: 90 },
        { lat: 89.999, lng: 180 },
      ],
      [
        'guney kutbu',
        { lat: -89.999, lng: 45 },
        { lat: -89.9995, lng: -45 },
        { lat: -89.999, lng: -135 },
      ],
      ['hepsi ayni nokta', MARKET_LOCATION, MARKET_LOCATION, MARKET_LOCATION],
    ];
    for (const [name, from, pickup, dropoff] of cases) {
      const plan = planRoute({ from, pickup, dropoff }, rule(20));
      expect({ name, problems: violations({ from, pickup, dropoff }, plan, 20) }).toEqual({
        name,
        problems: [],
      });
    }
  });
});
