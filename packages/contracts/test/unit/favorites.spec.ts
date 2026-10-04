/**
 * Favori marketler (T11.13): liste satiri, sinir ve ekleme/cikarma cevabi.
 */

import { describe, expect, it } from 'vitest';

import {
  FAVORITE_MARKETS_MAX,
  favoriteMarketListSchema,
  favoriteStatusSchema,
} from '../../src/index.js';

const TRY = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

const ITEM = {
  market: {
    id: 'mkt_moda-kasabi',
    name: 'Moda Kasabı',
    brand: 'Moda Kasabı',
    storeType: 'KASAP',
    coverUrl: 'https://cdn.example.com/img/market/kasap.jpg',
    location: { lat: 40.99, lng: 29.03 },
    deliveryRadiusMeters: 1500,
    isOpen: true,
    deliveryTime: { minMinutes: 20, maxMinutes: 30 },
    rating: { average: 4.8, count: 610 },
    pricingRules: {
      minBasket: TRY(30000),
      deliveryFee: TRY(2990),
      freeDeliveryThreshold: TRY(75000),
    },
  },
  addedAt: '2026-10-04T09:00:00.000Z',
};

describe('favoriteMarketListSchema', () => {
  it('market ve eklenme zamani; bos liste gecerli', () => {
    expect(favoriteMarketListSchema.parse({ items: [ITEM] }).items[0]?.market.id).toBe(
      'mkt_moda-kasabi',
    );
    expect(favoriteMarketListSchema.safeParse({ items: [] }).success).toBe(true);
  });

  it(`en fazla ${FAVORITE_MARKETS_MAX} favori (sinirli liste)`, () => {
    const full = Array.from({ length: FAVORITE_MARKETS_MAX }, () => ITEM);
    expect(favoriteMarketListSchema.safeParse({ items: full }).success).toBe(true);
    expect(favoriteMarketListSchema.safeParse({ items: [...full, ITEM] }).success).toBe(false);
  });

  it('eklenme zamani ISO 8601 olmali', () => {
    expect(
      favoriteMarketListSchema.safeParse({ items: [{ ...ITEM, addedAt: 'dun' }] }).success,
    ).toBe(false);
  });
});

describe('favoriteStatusSchema', () => {
  it('market kimligi sozlesme biciminde', () => {
    expect(
      favoriteStatusSchema.safeParse({ marketId: 'mkt_sok-moda', isFavorite: true }).success,
    ).toBe(true);
    expect(favoriteStatusSchema.safeParse({ marketId: 'sok-moda', isFavorite: true }).success).toBe(
      false,
    );
  });
});
