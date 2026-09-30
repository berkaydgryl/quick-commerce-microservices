import type { SearchResult } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import { hiddenProductCount } from '../../src/features/search/services/search-result';

const product = {
  id: 'prd_su-5l',
  offerId: 'ofr_a101-caferaga-su-5l',
  marketId: 'mkt_a101-caferaga',
  sku: 'SU-5L',
  name: 'Su 5 L',
  categoryId: 'cat_icecek',
  price: { amountMinor: 2750, currency: 'TRY' as const },
  isActive: true,
};

function resultWith(shown: number, total: number): SearchResult {
  return {
    market: {
      id: 'mkt_a101-caferaga',
      name: 'A101 – Caferağa',
      brand: 'A101',
      location: { lat: 40.99, lng: 29.03 },
      deliveryRadiusMeters: 2000,
      isOpen: true,
      deliveryTime: { minMinutes: 20, maxMinutes: 35 },
      rating: { average: 4.3, count: 800 },
      pricingRules: {
        minBasket: { amountMinor: 10_000, currency: 'TRY' },
        deliveryFee: { amountMinor: 1499, currency: 'TRY' },
        freeDeliveryThreshold: { amountMinor: 30_000, currency: 'TRY' },
      },
    },
    distanceMeters: 216,
    marketNameMatched: false,
    products: Array.from({ length: shown }, () => product),
    totalProductMatches: total,
  };
}

describe('hiddenProductCount ("+N urun daha")', () => {
  it('toplamdan gosterilenler cikar: "su" A101 de 3 gosterilir, toplam 4 -> +1', () => {
    expect(hiddenProductCount(resultWith(3, 4))).toBe(1);
  });

  it('hepsi gosteriliyorsa baglanti yok (0)', () => {
    expect(hiddenProductCount(resultWith(2, 2))).toBe(0);
  });

  it('yalnizca adi eslesen market: urun yok, 0', () => {
    expect(hiddenProductCount(resultWith(0, 0))).toBe(0);
  });

  it('sozlesmeye aykiri toplam (gosterilenden az) negatif sayi uretmez', () => {
    expect(hiddenProductCount(resultWith(3, 1))).toBe(0);
  });
});
