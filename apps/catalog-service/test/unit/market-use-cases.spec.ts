/**
 * Pazaryeri use-case'leri (ADR-15): bellek okuyuculariyla, demo verisi uzerinde.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { createGetMarket } from '../../src/application/get-market.js';
import { createListMarketCategories } from '../../src/application/list-market-categories.js';
import { createListNearbyMarkets } from '../../src/application/list-nearby-markets.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import type { DemoAddressTitle } from '../support/demo-addresses.js';
import { demoLocation, EXPECTED_NEARBY } from '../support/demo-addresses.js';

const readers = createInMemoryReaders();
const listNearbyMarkets = createListNearbyMarkets({ markets: readers.markets });
const getMarket = createGetMarket({ markets: readers.markets });
const listMarketCategories = createListMarketCategories(readers);

describe('listNearbyMarkets', () => {
  it.each(['Ev', 'İş', 'Yazlık'] as const)(
    '%s: hizmet veren marketler, yakindan uzaga; mesafe yuvarlanmamis metre',
    async (title: DemoAddressTitle) => {
      const nearby = await listNearbyMarkets(demoLocation(title));
      const expected = EXPECTED_NEARBY[title];

      expect(nearby.map((entry) => entry.market.id)).toEqual(
        expected.map((entry) => entry.marketId),
      );
      // Tam sayiya yuvarlama tasima isidir (mapper); burada ham mesafe,
      // beklenen tam sayiya yarim metreden yakin.
      nearby.forEach((entry, index) => {
        expect(entry.distanceMeters).toBeCloseTo(expected[index]?.meters ?? Number.NaN, 0);
      });
    },
  );

  it('kapali market listede kalir ("Kapali" rozeti)', async () => {
    const nearby = await listNearbyMarkets(demoLocation('İş'));

    expect(nearby.find((entry) => entry.market.id === 'mkt_a101-abbasaga')?.market.isOpen).toBe(
      false,
    );
  });

  it('yaricap disindaki market listelenmez: mesafe her zaman yaricap icinde', async () => {
    const nearby = await listNearbyMarkets(demoLocation('Ev'));

    for (const entry of nearby) {
      expect(entry.distanceMeters).toBeLessThanOrEqual(entry.market.deliveryRadiusMeters);
    }
  });
});

describe('getMarket', () => {
  it('marketi kurallariyla dondurur', async () => {
    expect((await getMarket('mkt_a101-caferaga')).pricingRules.minBasketMinor).toBe(10000);
  });

  it('bilinmeyen market NOT_FOUND', async () => {
    const failing = getMarket('mkt_yok');

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});

describe('listMarketCategories', () => {
  it('manav yalnizca meyve-sebze kategorisini gosterir', async () => {
    const categories = await listMarketCategories('mkt_kardesler-manavi');

    expect(categories.map((category) => category.slug)).toEqual(['meyve-sebze']);
  });

  it('kategoriler vitrin sirasinda (sortOrder)', async () => {
    const categories = await listMarketCategories('mkt_migros-jet-moda');

    // Yalnizca teklifi olan kategoriler, vitrin sirasinda; aradaki numaralar urunsuz
    // kategorilerin (T11.6: firindan, temel gida, et-tavuk, dondurma).
    expect(categories.map((category) => category.sortOrder)).toEqual([1, 2, 6, 7, 9]);
  });

  it('bilinmeyen market NOT_FOUND (bos liste degil)', async () => {
    await expect(listMarketCategories('mkt_yok')).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});
