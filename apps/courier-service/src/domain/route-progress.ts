/**
 * Rotada ilerleme (saf, T13.3): rotanin uretildigi andan gecen SUREDEN
 * kuryenin o anki konumu, asamasi ve kalanlari. Tick isci ve GetTracking ayni
 * fonksiyonu kullanir; konum Mongo'ya her tick'te yazilmaz, her an yeniden
 * hesaplanir.
 *
 *   1. bacak : kurye -> market (rotanin ilk pickupIndex parcasi)
 *   bekleme  : kurye markete vardiginda hazirlik bitmediyse bekler; paket
 *              hazirlik suresi dolunca ve kurye marketteyken alinir
 *   2. bacak : market -> teslimat adresi
 *
 *   alma ani   = max(1. bacak / hiz, hazirlik suresi)
 *   varis ani  = alma ani + 2. bacak / hiz
 *
 * KAYITLI ALMA (#195): tick alma anini kaydettiyse alma ani O andir ve ikinci
 * bacak ondan baslar (varis = kayitli alma + 2. bacak / hiz). Hiz ayari yol
 * ortasinda degisse de ikinci bacak sifir saniye surmez, kayitli almadan sonra
 * asama TO_MARKET'a donmez. Saat kayitli almanin gerisindeyse hesap TO_MARKET
 * der; gosterim asamayi kayittan alir (tracking-view.ts).
 *
 * Ilerleme NOKTA BASINA degil MESAFEYLE olculur (QA B3): rota noktalari iki
 * bacakta farkli araliklidir; kurye her saniye hiz kadar yol alir ve bulundugu
 * parcada dogrusal ara degerle konumlanir (100 m olcekte yeterli).
 */

import type { GeoPoint } from './courier.js';
import { distanceMeters } from './geo.js';
import type { Route, RouteMovement } from './route.js';

/** Takibin asamasi (proto TrackingPhase, contracts trackingPhaseSchema). */
export const TRACKING_PHASE = {
  TO_MARKET: 'TO_MARKET',
  TO_CUSTOMER: 'TO_CUSTOMER',
  DELIVERED: 'DELIVERED',
} as const;

export type TrackingPhase = (typeof TRACKING_PHASE)[keyof typeof TRACKING_PHASE];

/** Hareket kurali (config: COURIER_SPEED_KMH, ORDER_PREP_SECONDS); rotaya da yazilir (#197). */
export type MovementRule = RouteMovement;

/**
 * Rotanin ilerledigi kural: rotanin kendi kaydi (#197; uretildigi andaki ayar),
 * yoksa (#197 oncesi rota) verilen o anki ayar.
 */
export function movementOf(route: Pick<Route, 'movement'>, current: MovementRule): MovementRule {
  return route.movement ?? current;
}

/** Rotanin zaman cizelgesi: saniye, rotanin uretildigi andan itibaren. */
export interface RouteSchedule {
  /** Kurye -> market yolu, metre. */
  readonly legOneMeters: number;
  /** Market -> adres yolu, metre. */
  readonly legTwoMeters: number;
  /** Market -> adres yolunun suresi, saniye (2. bacak / hiz). */
  readonly legTwoSeconds: number;
  /** Paketin alindigi an. */
  readonly pickupSeconds: number;
  /** Teslimat ani. */
  readonly arrivalSeconds: number;
}

/** Bir andaki ilerleme. Konum GERCEK konumdur; gizlilik kurali gosterimdedir. */
export interface RouteProgress {
  readonly phase: TrackingPhase;
  readonly position: GeoPoint;
  /** 2. bacakta kalan yol, metre (TO_MARKET'ta 2. bacagin tamami, DELIVERED'da 0). */
  readonly legTwoRemainingMeters: number;
  /** Teslimata kalan, saniye (yukari yuvarlanir; DELIVERED'da 0). */
  readonly etaSeconds: number;
  /** Paket alindiysa an (hesaplanan). */
  readonly pickedUpAt?: Date;
  /** Teslim edildiyse an (hesaplanan). */
  readonly deliveredAt?: Date;
}

const METERS_PER_SECOND_PER_KMH = 1 / 3.6;
const MILLISECONDS_PER_SECOND = 1_000;

/** Noktalar boyunca toplam yol, metre. */
export function polylineMeters(points: readonly GeoPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from !== undefined && to !== undefined) {
      total += distanceMeters(from, to);
    }
  }
  return total;
}

/**
 * Noktalar boyunca bastan `meters` metre ilerideki konum. Yol bittiyse son
 * nokta; negatif mesafe ilk nokta.
 */
export function pointAlong(points: readonly GeoPoint[], meters: number): GeoPoint {
  const first = points[0];
  if (first === undefined) {
    throw new Error('bos rota');
  }
  let left = Math.max(0, meters);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] ?? first;
    const to = points[index] ?? from;
    const segment = distanceMeters(from, to);
    if (left <= segment && segment > 0) {
      const ratio = left / segment;
      return {
        lat: from.lat + (to.lat - from.lat) * ratio,
        lng: from.lng + (to.lng - from.lng) * ratio,
      };
    }
    left -= segment;
  }
  return points[points.length - 1] ?? first;
}

/**
 * Kuryenin YAZILACAK konumu (canli konum, iptalde birakma; #174, #197): paket
 * alinmisken (kayitli) saat kaydin gerisindeyse hesap TO_MARKET der; o zaman
 * birinci bacak konumu (onceki musterinin sokagi olabilir) degil market noktasi.
 */
export function courierLocation(
  route: Pick<Route, 'points' | 'pickupIndex' | 'pickedUpAt'>,
  progress: Pick<RouteProgress, 'phase' | 'position'>,
): GeoPoint {
  if (route.pickedUpAt !== undefined && progress.phase === TRACKING_PHASE.TO_MARKET) {
    return routeLegs(route).legTwo[0] ?? progress.position;
  }
  return progress.position;
}

/** Rotanin iki bacagi: market noktasi ikisinde de var. */
export function routeLegs(route: Pick<Route, 'points' | 'pickupIndex'>): {
  readonly legOne: readonly GeoPoint[];
  readonly legTwo: readonly GeoPoint[];
} {
  return {
    legOne: route.points.slice(0, route.pickupIndex + 1),
    legTwo: route.points.slice(route.pickupIndex),
  };
}

export function routeSchedule(
  route: Pick<Route, 'points' | 'pickupIndex'>,
  rule: MovementRule,
): RouteSchedule {
  const speed = rule.speedKmh * METERS_PER_SECOND_PER_KMH;
  const { legOne, legTwo } = routeLegs(route);
  const legOneMeters = polylineMeters(legOne);
  const legTwoMeters = polylineMeters(legTwo);
  const pickupSeconds = Math.max(legOneMeters / speed, rule.prepSeconds);
  const legTwoSeconds = legTwoMeters / speed;
  return {
    legOneMeters,
    legTwoMeters,
    legTwoSeconds,
    pickupSeconds,
    arrivalSeconds: pickupSeconds + legTwoSeconds,
  };
}

/**
 * Alma ve varis anlari, rotanin uretildigi andan milisaniye. Kayitli alma
 * yoksa cizelgeden; varsa alma TAM kayittan (uretilmeden once bile olsa:
 * negatif), varis ondan 2. bacak suresi sonra.
 */
export function milestonesMs(
  route: Pick<Route, 'createdAt' | 'pickedUpAt'>,
  schedule: RouteSchedule,
): { readonly pickupMs: number; readonly arrivalMs: number } {
  if (route.pickedUpAt === undefined) {
    const pickupMs = Math.round(schedule.pickupSeconds * MILLISECONDS_PER_SECOND);
    return {
      pickupMs,
      arrivalMs: Math.max(pickupMs, Math.round(schedule.arrivalSeconds * MILLISECONDS_PER_SECOND)),
    };
  }
  const pickupMs = route.pickedUpAt.getTime() - route.createdAt.getTime();
  const legTwoMs = Math.round(schedule.legTwoSeconds * MILLISECONDS_PER_SECOND);
  return { pickupMs, arrivalMs: pickupMs + legTwoMs };
}

/**
 * `at` anindaki ilerleme. Rotanin uretildigi andan oncesi baslangic sayilir.
 * Sinirlar MILISANIYEDE: alma ve varis anlari milisaniyeye yuvarlanir ve o
 * andan itibaren yeni asama baslar (dondurulen pickedUpAt ile asama tutarli).
 * Kayitli alma varsa ikinci bacak ondan baslar (#195, milestonesMs).
 */
export function routeProgress(
  route: Pick<Route, 'points' | 'pickupIndex' | 'createdAt' | 'pickedUpAt' | 'movement'>,
  at: Date,
  current: MovementRule,
): RouteProgress {
  const rule = movementOf(route, current);
  const speed = rule.speedKmh * METERS_PER_SECOND_PER_KMH;
  const schedule = routeSchedule(route, rule);
  const { legOne, legTwo } = routeLegs(route);
  const start = route.createdAt.getTime();
  const elapsedMs = Math.max(0, at.getTime() - start);
  const { pickupMs, arrivalMs } = milestonesMs(route, schedule);
  const etaSeconds = Math.ceil(Math.max(0, arrivalMs - elapsedMs) / MILLISECONDS_PER_SECOND);

  if (elapsedMs < pickupMs) {
    return {
      phase: TRACKING_PHASE.TO_MARKET,
      position: pointAlong(legOne, (elapsedMs / MILLISECONDS_PER_SECOND) * speed),
      legTwoRemainingMeters: Math.round(schedule.legTwoMeters),
      etaSeconds,
    };
  }
  const pickedUpAt = new Date(start + pickupMs);
  if (elapsedMs < arrivalMs) {
    const travelled = ((elapsedMs - pickupMs) / MILLISECONDS_PER_SECOND) * speed;
    return {
      phase: TRACKING_PHASE.TO_CUSTOMER,
      position: pointAlong(legTwo, travelled),
      legTwoRemainingMeters: Math.round(Math.max(0, schedule.legTwoMeters - travelled)),
      etaSeconds,
      pickedUpAt,
    };
  }
  return {
    phase: TRACKING_PHASE.DELIVERED,
    position: legTwo[legTwo.length - 1] ?? pointAlong(legTwo, schedule.legTwoMeters),
    legTwoRemainingMeters: 0,
    etaSeconds: 0,
    pickedUpAt,
    deliveredAt: new Date(start + arrivalMs),
  };
}
