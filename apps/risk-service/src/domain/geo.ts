/**
 * Iki koordinat arasindaki kus ucusu mesafe (haversine). Saf fonksiyon.
 * Sehir olcegi icin yeterince dogrudur; yol mesafesi degildir.
 */

import type { GeoPoint } from './risk-context.js';

const EARTH_RADIUS_KM = 6371;
const DEGREES_TO_RADIANS = Math.PI / 180;

export function distanceKm(from: GeoPoint, to: GeoPoint): number {
  const dLat = (to.lat - from.lat) * DEGREES_TO_RADIANS;
  const dLng = (to.lng - from.lng) * DEGREES_TO_RADIANS;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(from.lat * DEGREES_TO_RADIANS) *
      Math.cos(to.lat * DEGREES_TO_RADIANS) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}
