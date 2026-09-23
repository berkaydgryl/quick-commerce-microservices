/**
 * MarketReader SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration) kosar. MOCK modu ile gercek mod ayni marketleri, ayni
 * sirada ve ayni mesafeyle (+-1 m) gostermeli.
 */

import { describe, expect, it } from 'vitest';

import type { MarketReader } from '../../src/domain/market-reader.js';
import { demoLocation } from './demo-addresses.js';

const ALL = 20;

export function describeMarketReaderContract(name: string, getReader: () => MarketReader): void {
  describe(`MarketReader sozlesmesi: ${name}`, () => {
    it('Ev: en yakindan uzaga siralanir, ilk uc Kadikoy marketi (+-1 m)', async () => {
      const ranked = await getReader().listMarketsByDistance(demoLocation('Ev'), ALL);

      expect(ranked.slice(0, 3).map((entry) => entry.market.id)).toEqual([
        'mkt_a101-caferaga',
        'mkt_kardesler-manavi',
        'mkt_migros-jet-moda',
      ]);
      expect(Math.abs((ranked[0]?.distanceMeters ?? Number.NaN) - 216)).toBeLessThanOrEqual(1);
      const distances = ranked.map((entry) => entry.distanceMeters);
      expect(distances).toEqual([...distances].sort((left, right) => left - right));
    });

    it('kapali marketi de dondurur: acik/kapali karari domain in', async () => {
      const ranked = await getReader().listMarketsByDistance(demoLocation('İş'), ALL);

      expect(ranked.find((entry) => entry.market.id === 'mkt_a101-abbasaga')?.market.isOpen).toBe(
        false,
      );
    });

    it('limit uygulanir', async () => {
      expect(await getReader().listMarketsByDistance(demoLocation('Ev'), 2)).toHaveLength(2);
    });

    it('getMarket: kurallari ve puani tasir; yoksa null', async () => {
      const reader = getReader();
      const migros = await reader.getMarket('mkt_migros-jet-moda');

      expect(migros?.pricingRules).toEqual({
        minBasketMinor: 4000,
        deliveryFeeMinor: 2490,
        freeDeliveryThresholdMinor: 30000,
      });
      expect(migros?.rating).toEqual({ averageTenths: 47, count: 1200 });
      expect(migros?.deliveryTime).toEqual({ minMinutes: 15, maxMinutes: 25 });
      expect(await reader.getMarket('mkt_yok')).toBeNull();
    });

    it('marketExists', async () => {
      const reader = getReader();

      expect(await reader.marketExists('mkt_a101-caferaga')).toBe(true);
      expect(await reader.marketExists('mkt_yok')).toBe(false);
    });
  });
}
