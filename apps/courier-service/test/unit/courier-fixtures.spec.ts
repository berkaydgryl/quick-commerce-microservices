/**
 * Demo kuryeleri katalogla tutarli mi (T13.1)? Katalogdaki HER marketin
 * kuryesi olmali, konumu marketin konumu olmali; katalogda olmayan markete
 * kurye olmamali. Biri degisip digeri unutulursa siparise kurye atanamazdi.
 *
 * Test katalogun DEMO VERISINI okur (servis kodunu degil); her servis kendi
 * seed'ini yazar (ADR-05), tutarliligi bu test denetler.
 */

import { describe, expect, it } from 'vitest';

import { MARKETS } from '../../../catalog-service/src/infrastructure/fixtures/markets.js';
import { assertValidSeeds } from '../../src/application/seed-couriers.js';
import { COURIERS_PER_MARKET } from '../../src/config/constants.js';
import {
  COURIER_SEEDS,
  courierSeedId,
  MARKET_LOCATIONS,
} from '../../src/infrastructure/fixtures/couriers.js';

describe('demo kuryeleri (T13.1)', () => {
  it('market kimlikleri ve konumlari katalogla ayni', () => {
    const catalog = MARKETS.map((market) => ({
      marketId: market.id,
      lat: market.lat,
      lng: market.lng,
    }));

    expect([...MARKET_LOCATIONS].sort(byMarket)).toEqual(catalog.sort(byMarket));
  });

  it('her markette uc kurye, hepsi marketin konumunda', () => {
    for (const market of MARKET_LOCATIONS) {
      const couriers = COURIER_SEEDS.filter((seed) => seed.marketId === market.marketId);
      expect(couriers, market.marketId).toHaveLength(COURIERS_PER_MARKET);
      for (const courier of couriers) {
        expect(courier.location).toEqual({ lat: market.lat, lng: market.lng });
      }
    }
    expect(COURIER_SEEDS).toHaveLength(MARKET_LOCATIONS.length * COURIERS_PER_MARKET);
  });

  it('seed dogrulamasindan gecer; adlar tekil', () => {
    expect(() => assertValidSeeds(COURIER_SEEDS)).not.toThrow();
    expect(new Set(COURIER_SEEDS.map((seed) => seed.name)).size).toBe(COURIER_SEEDS.length);
  });

  it('kimlikler sabit: ayni market ve sira her kosuda ayni kimligi verir', () => {
    expect(courierSeedId('mkt_migros-jet-moda', 1)).toBe(courierSeedId('mkt_migros-jet-moda', 1));
    expect(courierSeedId('mkt_migros-jet-moda', 1)).not.toBe(
      courierSeedId('mkt_migros-jet-moda', 2),
    );
    expect(courierSeedId('mkt_migros-jet-moda', 1)).toMatch(/^crr_[0-9a-f]{32}$/);
  });
});

function byMarket(left: { marketId: string }, right: { marketId: string }): number {
  return left.marketId.localeCompare(right.marketId);
}
