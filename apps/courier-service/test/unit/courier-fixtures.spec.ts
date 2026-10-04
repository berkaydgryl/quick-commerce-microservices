/**
 * Demo kuryeleri ve market kopyasi katalogla tutarli mi (T13.1; havuz T13.2)?
 * Katalogdaki HER marketin konumu kopyada olmali ve her marketin cevresinde
 * bos kurye bulunmali; kuryeler semtlerine dagilmali ve iki semt havuzu
 * karismamali (3 km).
 *
 * Test katalogun DEMO VERISINI okur (servis kodunu degil); her servis kendi
 * seed'ini yazar (ADR-05), tutarliligi bu test denetler.
 */

import { describe, expect, it } from 'vitest';

import { MARKETS } from '../../../catalog-service/src/infrastructure/fixtures/markets.js';
import { assertValidMarkets, assertValidSeeds } from '../../src/application/seed-couriers.js';
import {
  COURIER_POOL_RADIUS_METERS,
  DEMO_COURIERS_PER_MARKET_AREA,
} from '../../src/config/constants.js';
import { distanceMeters } from '../../src/domain/geo.js';
import {
  COURIER_SEEDS,
  courierSeedId,
  MARKET_LOCATION_SEEDS,
  MARKET_LOCATIONS,
} from '../../src/infrastructure/fixtures/couriers.js';

/** Demo verisinde Kadikoy 41. enlemin guneyinde, Besiktas kuzeyinde. */
const isKadikoy = (point: { lat: number }): boolean => point.lat < 41;

describe('demo kuryeleri ve market kopyasi (T13.2 havuz)', () => {
  it('market kimlikleri ve konumlari katalogla ayni; kopya ayni listeden', () => {
    const catalog = MARKETS.map((market) => ({
      marketId: market.id,
      lat: market.lat,
      lng: market.lng,
    }));

    expect([...MARKET_LOCATIONS].sort(byMarket)).toEqual(catalog.sort(byMarket));
    expect(MARKET_LOCATION_SEEDS).toEqual(
      MARKET_LOCATIONS.map((market) => ({
        marketId: market.marketId,
        location: { lat: market.lat, lng: market.lng },
      })),
    );
    expect(() => assertValidMarkets(MARKET_LOCATION_SEEDS)).not.toThrow();
  });

  it('her marketin 40-150 m yakininda 3 kurye; toplam 63 (Kadikoy 30, Besiktas 33)', () => {
    for (const market of MARKET_LOCATIONS) {
      const close = COURIER_SEEDS.filter((seed) => {
        const distance = distanceMeters(market, seed.location);
        return distance >= 39 && distance <= 151;
      });
      expect(close.length, market.marketId).toBeGreaterThanOrEqual(DEMO_COURIERS_PER_MARKET_AREA);
    }
    expect(COURIER_SEEDS).toHaveLength(MARKET_LOCATIONS.length * DEMO_COURIERS_PER_MARKET_AREA);
    expect(COURIER_SEEDS.filter((seed) => isKadikoy(seed.location))).toHaveLength(30);
    expect(COURIER_SEEDS.filter((seed) => !isKadikoy(seed.location))).toHaveLength(33);
  });

  it('semtler karismaz: her kurye kendi semtinin butun marketlerinin havuzunda, obur semtinkilerin disinda', () => {
    for (const seed of COURIER_SEEDS) {
      for (const market of MARKET_LOCATIONS) {
        const distance = distanceMeters(market, seed.location);
        if (isKadikoy(market) === isKadikoy(seed.location)) {
          expect(distance, `${seed.id} -> ${market.marketId}`).toBeLessThanOrEqual(
            COURIER_POOL_RADIUS_METERS,
          );
        } else {
          expect(distance, `${seed.id} -> ${market.marketId}`).toBeGreaterThan(
            COURIER_POOL_RADIUS_METERS,
          );
        }
      }
    }
  });

  it('seed dogrulamasindan gecer; adlar ve konumlar tekil', () => {
    expect(() => assertValidSeeds(COURIER_SEEDS)).not.toThrow();
    expect(new Set(COURIER_SEEDS.map((seed) => seed.name)).size).toBe(COURIER_SEEDS.length);
    expect(
      new Set(COURIER_SEEDS.map((seed) => `${seed.location.lat},${seed.location.lng}`)).size,
    ).toBe(COURIER_SEEDS.length);
  });

  it('kimlikler ve konumlar sabit: ayni market ve sira her kosuda ayni sonucu verir', () => {
    expect(courierSeedId('mkt_migros-jet-moda', 1)).toBe(courierSeedId('mkt_migros-jet-moda', 1));
    expect(courierSeedId('mkt_migros-jet-moda', 1)).not.toBe(
      courierSeedId('mkt_migros-jet-moda', 2),
    );
    expect(courierSeedId('mkt_migros-jet-moda', 1)).toMatch(/^crr_[0-9a-f]{32}$/);
    // T13.1'deki kimlikler korunur: yerel veritabanindaki kayitlar ayni kuryeler.
    expect(COURIER_SEEDS[0]?.id).toBe(courierSeedId('mkt_migros-jet-moda', 1));
  });
});

function byMarket(left: { marketId: string }, right: { marketId: string }): number {
  return left.marketId.localeCompare(right.marketId);
}
