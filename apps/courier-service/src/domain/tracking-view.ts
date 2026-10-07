/**
 * Takibin gosterimi (saf, T13.3): ilerlemeden (route-progress.ts) istemciye
 * gidecek degerler. Kurallar @getir/contracts tracking.ts enforceTrackingPhase
 * ile AYNI; oradaki sema bu ciktiyi dogrular.
 *
 * GIZLILIK: kurye bir teslimattan sonra ONCEKI musterinin adresinde bosa cikar
 * ve oradan atanir. Paket alinmadan (TO_MARKET): konum YOK, kalan yol yalnizca
 * market -> adres bacagi, varis tahmini dakikaya yukari yuvarlanir; rota hep
 * market -> adres parcasidir (ilk bacak verilmez).
 *
 * Asama TEK YONLUDUR: kaydedilmis kilometre tasi (pickedUpAt, deliveredAt)
 * asamayi geri goturmez (or. hiz ayari degisip hesap geride kalsa da).
 */

import { TRACKING_ETA_STEP_BEFORE_PICKUP_SECONDS } from '@getir/contracts';

import type { GeoPoint } from './courier.js';
import type { Route } from './route.js';
import type { RouteProgress, TrackingPhase } from './route-progress.js';
import { routeLegs, TRACKING_PHASE } from './route-progress.js';

export interface TrackingView {
  readonly phase: TrackingPhase;
  /** TO_MARKET'ta yok. */
  readonly location?: GeoPoint;
  readonly remainingMeters: number;
  readonly etaSeconds: number;
  /** Market -> adres parcasi: ilk nokta market, son nokta adres. */
  readonly route: readonly GeoPoint[];
  readonly marketLocation: GeoPoint;
  readonly deliveryLocation: GeoPoint;
  readonly pickedUpAt?: Date;
  readonly deliveredAt?: Date;
}

const PHASE_ORDER: readonly TrackingPhase[] = [
  TRACKING_PHASE.TO_MARKET,
  TRACKING_PHASE.TO_CUSTOMER,
  TRACKING_PHASE.DELIVERED,
];

function recordedPhase(route: Pick<Route, 'pickedUpAt' | 'deliveredAt'>): TrackingPhase {
  if (route.deliveredAt !== undefined) {
    return TRACKING_PHASE.DELIVERED;
  }
  return route.pickedUpAt !== undefined ? TRACKING_PHASE.TO_CUSTOMER : TRACKING_PHASE.TO_MARKET;
}

/** Paket alinmadan gosterilen tahmin: dakikaya YUKARI yuvarli (gizlilik). */
function roundedBeforePickup(etaSeconds: number): number {
  return (
    Math.ceil(etaSeconds / TRACKING_ETA_STEP_BEFORE_PICKUP_SECONDS) *
    TRACKING_ETA_STEP_BEFORE_PICKUP_SECONDS
  );
}

function later(left: TrackingPhase, right: TrackingPhase): TrackingPhase {
  return PHASE_ORDER.indexOf(left) >= PHASE_ORDER.indexOf(right) ? left : right;
}

export function trackingView(
  route: Pick<Route, 'points' | 'pickupIndex' | 'pickedUpAt' | 'deliveredAt'>,
  progress: RouteProgress,
): TrackingView {
  const { legTwo } = routeLegs(route);
  const market = legTwo[0] ?? progress.position;
  const dropoff = legTwo[legTwo.length - 1] ?? market;
  const base = { route: legTwo, marketLocation: market, deliveryLocation: dropoff };
  const phase = later(progress.phase, recordedPhase(route));
  const pickedUpAt = route.pickedUpAt ?? progress.pickedUpAt;

  if (phase === TRACKING_PHASE.TO_MARKET) {
    return {
      ...base,
      phase,
      remainingMeters: progress.legTwoRemainingMeters,
      etaSeconds: roundedBeforePickup(progress.etaSeconds),
    };
  }
  if (phase === TRACKING_PHASE.TO_CUSTOMER) {
    // Hesap geride kalabilir (kayitli alma ani, hiz ayari degisti): o zaman
    // konum market ve tahmin yine yuvarli; ilk bacagin suresi sizmaz.
    const ahead = progress.phase === TRACKING_PHASE.TO_CUSTOMER;
    return {
      ...base,
      phase,
      location: ahead ? progress.position : market,
      remainingMeters: progress.legTwoRemainingMeters,
      etaSeconds: ahead ? progress.etaSeconds : roundedBeforePickup(progress.etaSeconds),
      ...(pickedUpAt === undefined ? {} : { pickedUpAt }),
    };
  }
  const deliveredAt = route.deliveredAt ?? progress.deliveredAt;
  return {
    ...base,
    phase,
    location: dropoff,
    remainingMeters: 0,
    etaSeconds: 0,
    ...(pickedUpAt === undefined ? {} : { pickedUpAt }),
    ...(deliveredAt === undefined ? {} : { deliveredAt }),
  };
}
