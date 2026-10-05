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

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

type Vector = readonly [number, number, number];

/** Birim kure uzerindeki konum vektoru. */
function toVector({ lat, lng }: GeoPoint): Vector {
  const phi = toRadians(lat);
  const lambda = toRadians(lng);
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

function fromVector([x, y, z]: Vector): GeoPoint {
  return { lat: toDegrees(Math.atan2(z, Math.hypot(x, y))), lng: toDegrees(Math.atan2(y, x)) };
}

/** Iki birim vektor arasindaki merkez acisi (atan2: kucuk acida da kararli). */
function centralAngle(a: Vector, b: Vector): number {
  const cross = Math.hypot(
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  );
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.atan2(cross, dot);
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

/**
 * `from`'dan `to`'ya buyuk daire uzerinde `segments` esit parca: segments + 1
 * nokta, uclar birebir (kopyalanmaz, ayni degerler). Ara noktalar kuresel
 * dogrusal araradegerleme (slerp) ile: ardisik iki nokta arasi mesafe hep ayni.
 * segments = 0 ise yalnizca `from`.
 */
export function greatCirclePoints(from: GeoPoint, to: GeoPoint, segments: number): GeoPoint[] {
  if (segments === 0) {
    return [from];
  }
  const a = toVector(from);
  const b = toVector(to);
  const omega = centralAngle(a, b);
  const points: GeoPoint[] = [from];
  for (let step = 1; step < segments; step += 1) {
    if (omega === 0) {
      points.push(from);
      continue;
    }
    const t = step / segments;
    const wa = Math.sin((1 - t) * omega) / Math.sin(omega);
    const wb = Math.sin(t * omega) / Math.sin(omega);
    points.push(fromVector([wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]]));
  }
  points.push(to);
  return points;
}
