/**
 * Aday siniri senaryolari (#175): konuma YAKIN ama kapsamayan bircok market ve
 * arkalarinda genis yaricapli tek kapsayan market; yaricap sinirinin iki yani.
 * Bellek ve Mongo ayni marketlerle kosar (covering-limit-contract.ts).
 */

import type { GeoPoint } from '@getir/core';

import type { Market } from '../../src/domain/catalog.js';
import { CLASSIC_SNAPSHOT } from './classic-catalog.js';

/** Senaryonun konumu (Kadikoy'den uzak; demo marketleriyle karismaz). */
export const CROWDED_POINT: GeoPoint = { lat: 40.5, lng: 29.5 };

/** Mongo'nun ve bellegin kullandigi ekvator yaricapi (domain geo.ts ile ayni). */
const EARTH_RADIUS_METERS = 6_378_100;

/** Noktanin `meters` metre kuzeyi: buyuk daire mesafesi tam `meters`. */
export function northOf(point: GeoPoint, meters: number): GeoPoint {
  return { lat: point.lat + (meters / EARTH_RADIUS_METERS) * (180 / Math.PI), lng: point.lng };
}

const BASE = CLASSIC_SNAPSHOT.markets[0];

/** Klasik ilk marketin kopyasi: kimlik, ad, konum ve yaricap degisir. */
export function marketAt(id: string, location: GeoPoint, deliveryRadiusMeters: number): Market {
  if (BASE === undefined) {
    throw new Error('klasik katalogda market yok');
  }
  return { ...BASE, id, name: id, brand: id, ...location, deliveryRadiusMeters, isOpen: true };
}

/** Kapsamayan yakin marketlerin sayisi: aday siniri (20) + 1. */
export const NEAR_NOT_COVERING = 21;
export const WIDE_MARKET_ID = 'mkt_genis-yaricap';

/**
 * 21 yakin (300-1300 m) ama yaricapi 100 m olan market ve 3 km uzakta, 5 km
 * yaricapli tek kapsayan market. Eski sorgu en yakin 20'yi alip suzdugu icin
 * genis marketi hic gormuyordu.
 */
export function crowdedMarkets(): Market[] {
  return [
    ...nearNotCovering(NEAR_NOT_COVERING),
    marketAt(WIDE_MARKET_ID, northOf(CROWDED_POINT, 3_000), 5_000),
  ];
}

/** Konuma 300 m'den baslayip 50 m arayla yakin, yaricapi 100 m (kapsamayan) `count` market. */
export function nearNotCovering(count: number): Market[] {
  return Array.from({ length: count }, (_, index) =>
    marketAt(
      `mkt_yakin-${String(index + 1).padStart(2, '0')}`,
      northOf(CROWDED_POINT, 300 + index * 50),
      100,
    ),
  );
}

/** Kapsayan `count` market (yaricap 5 km), 100 m arayla: sinir kapsayanlara uygulanir. */
export function coveringCrowd(count: number): Market[] {
  return Array.from({ length: count }, (_, index) =>
    marketAt(
      `mkt_kapsayan-${String(index + 1).padStart(2, '0')}`,
      northOf(CROWDED_POINT, 100 + index * 100),
      5_000,
    ),
  );
}
