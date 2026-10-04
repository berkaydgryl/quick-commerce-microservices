/**
 * Kurye havuzu kurali (T13.2, kullanici karari): kurye bir markete bagli
 * degildir; siparisin marketinin cevresindeki BOS kuryelerden biri atanir.
 * Saf: mesafeyi ve sirayi tanimlar, depoya bakmaz.
 *
 *   - Havuz: marketin `radiusMeters` (3 km) icindeki IDLE kuryeler; OFFLINE
 *     ve BUSY girmez.
 *   - Sira: once yakinlik DILIMI (floor(mesafe / bandMeters), 300 m), dilim
 *     icinde en uzun suredir bosta olan (idleSince), esitlikte kimlik.
 *
 * Neden dilim: tam mesafe esitligi nadir; salt "en yakin" kurali birbirine
 * yakin kuryelerden hep ayni birine is verirdi. Dilim icinde bekleme suresi
 * adaleti saglar (#88), uzaktaki kurye yakindakinin onune gecmez.
 */

import type { Courier } from './courier.js';

export interface PoolRule {
  readonly radiusMeters: number;
  readonly bandMeters: number;
}

/** Havuzdaki bir aday ve markete uzakligi. */
export interface PoolCandidate {
  readonly courier: Courier;
  readonly distanceMeters: number;
}

/** Yakinlik dilimi: 0 = ilk bandMeters, 1 = sonraki... */
export function proximityBand(distanceMeters: number, bandMeters: number): number {
  return Math.floor(distanceMeters / bandMeters);
}

/**
 * Secim sirasi: dilim, sonra bosta bekleme baslangici (eski once; alani
 * olmayan en one, Mongo'daki eksik alan sirasi gibi), sonra kimlik.
 */
export function comparePoolCandidates(
  left: PoolCandidate,
  right: PoolCandidate,
  bandMeters: number,
): number {
  const byBand =
    proximityBand(left.distanceMeters, bandMeters) -
    proximityBand(right.distanceMeters, bandMeters);
  if (byBand !== 0) {
    return byBand;
  }
  const leftIdle = left.courier.idleSince?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightIdle = right.courier.idleSince?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (leftIdle !== rightIdle) {
    return leftIdle < rightIdle ? -1 : 1;
  }
  return left.courier.id < right.courier.id ? -1 : left.courier.id > right.courier.id ? 1 : 0;
}

/** Marketin havuzunda mi: yaricap SINIRI DAHIL. */
export function isWithinPool(distance: number, rule: PoolRule): boolean {
  return distance <= rule.radiusMeters;
}
