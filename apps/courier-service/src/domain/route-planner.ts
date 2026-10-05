/**
 * Rota planlayici (saf, T13.2): iki parca buyuk daire, esit aralikli noktalar.
 *
 *   nokta sayisi N = clamp(ceil(toplam m / aralik), en az, en cok)  -> 20-40
 *   N - 1 parca iki bacaga uzunluk oraninda bolunur; uzunlugu olan bacak en az
 *   bir parca alir, kurye marketteyse ilk bacak 0 parca.
 *   Her bacakta noktalar buyuk daire uzerinde esit aralikli (geo.ts slerp);
 *   market noktasi birebir rotanin kosesi.
 *   ETA = ceil(yuvarlanmis toplam m / (hiz km/sa / 3,6)) sn: tek kaynak
 *   distanceMeters (QA B4), istemci ikisinden ayni sonucu cikarir.
 *
 * Esit aralik BACAK ICINDEdir: iki bacagin araligi uzunluk oranina gore yakin
 * ama esit degildir (kurye marketten 1 cm uzaktaysa ilk parca 1 cm). T13.3
 * simulasyonu nokta basina degil mesafe ya da zamanla ilerler (QA B3).
 */

import type { GeoPoint } from './courier.js';
import { distanceMeters, greatCirclePoints } from './geo.js';

/** Rota kurali (config/constants.ts, hiz ortamdan: COURIER_SPEED_KMH). */
export interface RouteRule {
  /** Hedeflenen nokta araligi (m); nokta sayisi bundan hesaplanir. */
  readonly spacingMeters: number;
  readonly minPoints: number;
  readonly maxPoints: number;
  /** Kurye hizi (km/sa). */
  readonly speedKmh: number;
}

export interface RouteLegs {
  /** Kuryenin atama anindaki konumu. */
  readonly from: GeoPoint;
  /** Market: paket alma noktasi. */
  readonly pickup: GeoPoint;
  /** Teslimat adresi. */
  readonly dropoff: GeoPoint;
}

export interface RoutePlan {
  readonly points: readonly GeoPoint[];
  readonly pickupIndex: number;
  readonly distanceMeters: number;
  readonly etaSeconds: number;
}

const SECONDS_PER_HOUR = 3_600;
const METERS_PER_KM = 1_000;

/** Toplam nokta sayisi: araliga gore, [en az, en cok] icinde. */
export function routePointCount(totalMeters: number, rule: RouteRule): number {
  const wanted = Math.ceil(totalMeters / rule.spacingMeters);
  return Math.min(rule.maxPoints, Math.max(rule.minPoints, wanted));
}

/** Ilk bacagin parca sayisi: uzunluk oraninda; uzunlugu olan bacak en az bir parca. */
export function firstLegSegments(toPickup: number, toDropoff: number, segments: number): number {
  if (toPickup === 0) {
    return 0;
  }
  const proportional = Math.round((segments * toPickup) / (toPickup + toDropoff));
  const upper = toDropoff === 0 ? segments : segments - 1;
  return Math.min(upper, Math.max(1, proportional));
}

/** Varis suresi (sn): toplam yol / hiz, yukari yuvarlanir. */
export function etaSeconds(totalMeters: number, speedKmh: number): number {
  return Math.ceil((totalMeters * SECONDS_PER_HOUR) / (speedKmh * METERS_PER_KM));
}

export function planRoute(legs: RouteLegs, rule: RouteRule): RoutePlan {
  const toPickup = distanceMeters(legs.from, legs.pickup);
  const toDropoff = distanceMeters(legs.pickup, legs.dropoff);
  const total = toPickup + toDropoff;
  const segments = routePointCount(total, rule) - 1;
  const first = firstLegSegments(toPickup, toDropoff, segments);
  const firstLeg = greatCirclePoints(legs.from, legs.pickup, first);
  // Ikinci bacak marketle baslar: market noktasi iki kez yazilmaz.
  const secondLeg = greatCirclePoints(legs.pickup, legs.dropoff, segments - first).slice(1);
  return {
    points: first === 0 ? [legs.pickup, ...secondLeg] : [...firstLeg, ...secondLeg],
    pickupIndex: first,
    distanceMeters: Math.round(total),
    etaSeconds: etaSeconds(Math.round(total), rule.speedKmh),
  };
}
