/**
 * Kure uzerinde mesafe (saf). catalog ve risk'teki kopyayla AYNI kural ve
 * yaricap (bekleyen is #86: @getir/core'a tasinacak).
 *
 * Bellek uygulamasi (MOCK) icin: Mongo mesafeyi $geoNear ile kendisi hesaplar.
 * Iki uygulamanin ayni sirayi verdigi sozlesme testinde olculur.
 */

import type { GeoPoint } from './courier.js';

/**
 * Dunya yaricapi (metre): MongoDB'nin 2dsphere mesafe hesabinda kullandigi
 * EKVATOR yaricapi, 6378,1 km. Ortalama yaricapla (6371,0 km) bellek ve Mongo
 * ayni mesafeyi vermezdi (catalog domain/geo.ts'te olculdu).
 */
const EARTH_RADIUS_METERS = 6_378_100;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Iki nokta arasindaki buyuk daire mesafesi (haversine), metre. */
export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}
