/**
 * QA (T15.2, catalog geriye donuk PR 1): testin bagimsiz cografya kahini ve sabit tohumlu rastgele.
 * Konteyner yuklemez: birim testleri de kullanir.
 */

import type { GeoPoint } from '@getir/core';

/** $geoNear ve Mongo'nun kendi uzaklik hesabi: ekvator yaricapi (metre). */
const EARTH_RADIUS_METERS = 6_378_100;
const DEGREES_PER_RADIAN = 180 / Math.PI;

/** Testin bagimsiz uzaklik kahini (haversine, Mongo ile ayni yaricap); uretimin distanceMeters'ina yaslanmaz. */
export function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const rad = (degrees: number) => degrees / DEGREES_PER_RADIAN;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Noktadan kuzeye ve doguya metre kadar otelenmis nokta (kucuk uzakliklarda yeterli). */
export function offset(from: GeoPoint, northMeters: number, eastMeters: number): GeoPoint {
  const lat = from.lat + (northMeters / EARTH_RADIUS_METERS) * DEGREES_PER_RADIAN;
  const lng =
    from.lng +
    (eastMeters / (EARTH_RADIUS_METERS * Math.cos(from.lat / DEGREES_PER_RADIAN))) *
      DEGREES_PER_RADIAN;
  return { lat, lng };
}

/** Sabit tohumlu sozde rastgele (mulberry32): her kosu ayni dizi. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
