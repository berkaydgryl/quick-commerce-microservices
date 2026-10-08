/**
 * Rotada ilerleme (T13.3): zamandan konum, asama ve kalanlar. Saf fonksiyon;
 * an parametredir (saat yok). Rota planlayicinin gercek ciktisi uzerinde.
 */

import { describe, expect, it } from 'vitest';

import { distanceMeters } from '../../src/domain/geo.js';
import { deliveredNoEarlierThan } from '../../src/domain/route.js';
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

describe('routeProgress: kayitli alma ikinci bacagi baslatir (#195)', () => {
  const SLOW = { speedKmh: 6, prepSeconds: 600 };
  const FAST = { speedKmh: 120, prepSeconds: 0 };
  /** Ikinci bacagin suresi (ms), kurala gore. */
  const legTwoMs = (rule: typeof RULE) =>
    Math.round(routeSchedule(route(), rule).legTwoSeconds * 1_000);

  it('hiz ayari hizlansa da kayitli almadan sonra TO_CUSTOMER; varis = alma + 2. bacak / yeni hiz', () => {
    // Eski (yavas) ayarla alma 600. sn'de kaydedildi; yeni (hizli) ayarla cizelge
    // varisi cok once olurdu (ikinci bacak sifir saniye, TO_CUSTOMER atlanirdi).
    const recorded = { ...route(), pickedUpAt: after(600) };
    expect(routeSchedule(recorded, FAST).arrivalSeconds).toBeLessThan(600);

    const justAfter = routeProgress(recorded, after(600.5), FAST);
    expect(justAfter).toMatchObject({ phase: TRACKING_PHASE.TO_CUSTOMER, pickedUpAt: after(600) });

    const arrived = routeProgress(recorded, new Date(after(600).getTime() + legTwoMs(FAST)), FAST);
    expect(arrived).toMatchObject({
      phase: TRACKING_PHASE.DELIVERED,
      pickedUpAt: after(600),
      deliveredAt: new Date(after(600).getTime() + legTwoMs(FAST)),
    });
  });

  it('hiz ayari yavaslarsa ikinci bacak uzar; kayitli alma ani korunur', () => {
    const recorded = { ...route(), pickedUpAt: after(60) };
    const arrivalMs = after(60).getTime() + legTwoMs(SLOW);

    expect(routeProgress(recorded, new Date(arrivalMs - 1), SLOW).phase).toBe(
      TRACKING_PHASE.TO_CUSTOMER,
    );
    expect(routeProgress(recorded, new Date(arrivalMs), SLOW)).toMatchObject({
      phase: TRACKING_PHASE.DELIVERED,
      pickedUpAt: after(60),
      deliveredAt: new Date(arrivalMs),
    });
  });

  it('kayit x hiz ayari x her an: kayitli almadan sonra asla TO_MARKET; asama tek yonlu; ikinci bacak suresi tam', () => {
    for (const pickupSeconds of [0, 45, 114, 600]) {
      for (const rule of [SLOW, RULE, FAST]) {
        const pickedUpAt = after(pickupSeconds);
        const recorded = { ...route(), pickedUpAt };
        const order = [
          TRACKING_PHASE.TO_MARKET,
          TRACKING_PHASE.TO_CUSTOMER,
          TRACKING_PHASE.DELIVERED,
        ];
        let previous = 0;
        const end = pickupSeconds * 1_000 + legTwoMs(rule) + 5_000;
        for (let ms = -5_000; ms <= end; ms += 997) {
          const progress = routeProgress(recorded, new Date(START.getTime() + ms), rule);
          const at = `${pickupSeconds} sn alma, ${rule.speedKmh} km/sa, ${ms} ms`;
          const rank = order.indexOf(progress.phase);
          expect(rank, at).toBeGreaterThanOrEqual(previous);
          previous = rank;
          if (ms >= pickupSeconds * 1_000) {
            expect(progress.phase, at).not.toBe(TRACKING_PHASE.TO_MARKET);
            expect(progress.pickedUpAt, at).toEqual(pickedUpAt);
          }
          if (progress.phase === TRACKING_PHASE.DELIVERED) {
            expect(progress.deliveredAt?.getTime(), at).toBe(pickedUpAt.getTime() + legTwoMs(rule));
          }
        }
      }
    }
  });

  it('saat kayitli almanin gerisindeyse hesap TO_MARKET (gosterim asamayi kayittan alir)', () => {
    const recorded = { ...route(), pickedUpAt: after(300) };

    // Cizelgeye gore 200. sn'de paket alinmis olurdu; kayit 300. sn: hesap henuz TO_MARKET.
    expect(routeSchedule(recorded, RULE).pickupSeconds).toBeLessThan(200);
    expect(routeProgress(recorded, after(200), RULE).phase).toBe(TRACKING_PHASE.TO_MARKET);
  });

  it('kayitli alma rotanin uretilme anindan once ise de alma ani kayittir (kirpilmaz)', () => {
    const early = new Date(START.getTime() - 1_000);
    const recorded = { ...route(), pickedUpAt: early };

    expect(routeProgress(recorded, after(0), RULE)).toMatchObject({
      phase: TRACKING_PHASE.TO_CUSTOMER,
      pickedUpAt: early,
    });
    expect(routeProgress(recorded, after(3_600), RULE)).toMatchObject({
      phase: TRACKING_PHASE.DELIVERED,
      pickedUpAt: early,
      deliveredAt: new Date(early.getTime() + legTwoMs(RULE)),
    });
  });

  it('kayitsiz rota cizelgeyle AYNEN (eski davranis degismedi)', () => {
    const plain = route();
    const schedule = routeSchedule(plain, RULE);
    const arrivalMs = Math.round(schedule.arrivalSeconds * 1_000);

    expect(routeProgress(plain, new Date(START.getTime() + arrivalMs), RULE)).toMatchObject({
      phase: TRACKING_PHASE.DELIVERED,
      pickedUpAt: after(schedule.pickupSeconds),
      deliveredAt: new Date(START.getTime() + arrivalMs),
    });
  });
});

describe('deliveredNoEarlierThan (#190 savunmasi; tick ve takip ortak)', () => {
  it('teslim almadan once ise teslim = alma; degilse ya da alma yoksa teslim aynen', () => {
    expect(deliveredNoEarlierThan(after(10), after(20))).toEqual(after(20));
    expect(deliveredNoEarlierThan(after(30), after(20))).toEqual(after(30));
    expect(deliveredNoEarlierThan(after(20), after(20))).toEqual(after(20));
    expect(deliveredNoEarlierThan(after(10), undefined)).toEqual(after(10));
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
