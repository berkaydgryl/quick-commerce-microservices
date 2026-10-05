/** Testlerin kurye, konum ve kimlik ureticileri. Kimlikler sozlesme bicimindedir (crr_/ord_ + 32 hex). */

import { ID_PREFIX, newId } from '@getir/core';

import { COURIER_STATUS } from '../../src/domain/courier.js';
import type { Courier, GeoPoint } from '../../src/domain/courier.js';
import type { PoolRule } from '../../src/domain/courier-pool.js';
import type { RouteRule } from '../../src/domain/route-planner.js';
import type { MarketLocation } from '../../src/domain/market-locator.js';

/** Kadikoy'de iki market (aralari ~570 m) ve Besiktas'ta bir market (6,6 km uzakta). */
export const MARKET = 'mkt_migros-jet-moda';
export const MARKET_LOCATION: GeoPoint = { lat: 40.985, lng: 29.0275 };
export const OTHER_MARKET = 'mkt_a101-caferaga';
export const OTHER_MARKET_LOCATION: GeoPoint = { lat: 40.9895, lng: 29.024 };
export const FAR_MARKET = 'mkt_migros-jet-besiktas';
export const FAR_MARKET_LOCATION: GeoPoint = { lat: 41.0425, lng: 29.008 };

export const TEST_MARKETS: readonly MarketLocation[] = [
  { marketId: MARKET, location: MARKET_LOCATION },
  { marketId: OTHER_MARKET, location: OTHER_MARKET_LOCATION },
  { marketId: FAR_MARKET, location: FAR_MARKET_LOCATION },
];

/** Uretimdeki kural: 3 km havuz, 300 m dilim. */
export const POOL_RULE: PoolRule = { radiusMeters: 3_000, bandMeters: 300 };

/** Uretimdeki rota kurali (T13.2): 100 m aralik, 20-40 nokta, 20 km/sa. */
export const ROUTE_RULE: RouteRule = {
  spacingMeters: 100,
  minPoints: 20,
  maxPoints: 40,
  speedKmh: 20,
};

export const SEEDED_AT = new Date('2026-10-04T08:00:00.000Z');
export const NOW_MS = Date.parse('2026-10-04T09:00:00.000Z');

/** Enlem derecesinin metresi: domain/geo.ts'in yaricapiyla (6378,1 km). */
const METERS_PER_DEGREE_LAT = (6_378_100 * Math.PI) / 180;

/** `from`'un `meters` kuzeyi: haversine mesafesi metreye esit cikar. */
export function northOf(from: GeoPoint, meters: number): GeoPoint {
  return { lat: from.lat + meters / METERS_PER_DEGREE_LAT, lng: from.lng };
}

/** Sirali kurye kimligi: sozlugsel sira numarayla ayni (esitlik kurali testleri). */
export function courierId(order: number): string {
  return `${ID_PREFIX.COURIER}_${order.toString(16).padStart(32, '0')}`;
}

export const orderId = (): string => newId(ID_PREFIX.ORDER);

/** Varsayilan: IDLE, MARKET'in tam yerinde, bosta bekleme baslangici yok (en onde siralanir). */
export function courier(order: number, fields: Partial<Courier> = {}): Courier {
  return {
    id: courierId(order),
    name: `Kurye ${order}`,
    status: COURIER_STATUS.IDLE,
    lastLocation: MARKET_LOCATION,
    lastLocationAt: SEEDED_AT,
    ...fields,
  };
}

export const DELIVERY = { lat: 40.99, lng: 29.03 } as const;
