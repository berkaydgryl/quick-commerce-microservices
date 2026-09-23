/**
 * Pazaryeri sozlesmesi (ADR-15): market, yakindaki market listesi ve kimlikler.
 */

import { describe, expect, it } from 'vitest';

import {
  idSchema,
  marketIdSchema,
  marketSchema,
  nearbyMarketListSchema,
  nearbyMarketsQuerySchema,
  offerIdSchema,
  productIdSchema,
} from '../../src/index.js';

const TRY = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

const MIGROS_MODA = {
  id: 'mkt_migros-jet-moda',
  name: 'Migros Jet - Moda',
  brand: 'Migros Jet',
  logoUrl: 'https://cdn.example.com/img/market/migros-jet.png',
  location: { lat: 40.9867, lng: 29.0258 },
  deliveryRadiusMeters: 2500,
  isOpen: true,
  deliveryTime: { minMinutes: 15, maxMinutes: 25 },
  rating: { average: 4.7, count: 1200 },
  pricingRules: {
    minBasket: TRY(4000),
    deliveryFee: TRY(2490),
    freeDeliveryThreshold: TRY(30000),
  },
};

describe('marketSchema', () => {
  it('ekran tasarimindaki market bilgisini tasir: puan, sure, min. tutar', () => {
    const parsed = marketSchema.parse(MIGROS_MODA);

    expect(parsed.rating.average).toBe(4.7);
    expect(parsed.deliveryTime).toEqual({ minMinutes: 15, maxMinutes: 25 });
    expect(parsed.pricingRules.minBasket.amountMinor).toBe(4000);
  });

  it('fiyat kurallari ZORUNLU: pricing marketin kuralini parametre olarak alir', () => {
    const { pricingRules: _omitted, ...withoutRules } = MIGROS_MODA;

    expect(marketSchema.safeParse(withoutRules).success).toBe(false);
  });

  it('teslimat suresi araligi ters olamaz', () => {
    const reversed = { ...MIGROS_MODA, deliveryTime: { minMinutes: 30, maxMinutes: 20 } };

    expect(marketSchema.safeParse(reversed).success).toBe(false);
  });

  it('puan 0-5 araliginda', () => {
    expect(
      marketSchema.safeParse({ ...MIGROS_MODA, rating: { average: 5.1, count: 1 } }).success,
    ).toBe(false);
  });

  it('logo GORELI yol olamaz (mutlak URL gateway in isi)', () => {
    expect(
      marketSchema.safeParse({ ...MIGROS_MODA, logoUrl: '/img/market/migros.png' }).success,
    ).toBe(false);
  });

  it('logosu olmayan market gecerlidir', () => {
    const { logoUrl: _omitted, ...withoutLogo } = MIGROS_MODA;

    expect(marketSchema.safeParse(withoutLogo).success).toBe(true);
  });
});

describe('nearbyMarketsQuerySchema', () => {
  it('sorgu dizesindeki metni sayiya cevirir', () => {
    expect(nearbyMarketsQuerySchema.parse({ lat: '40.9885', lng: '29.0262' })).toEqual({
      lat: 40.9885,
      lng: 29.0262,
    });
  });

  it('konum ZORUNLU: eksik konum (0,0) gibi islenmez', () => {
    expect(nearbyMarketsQuerySchema.safeParse({}).success).toBe(false);
    expect(nearbyMarketsQuerySchema.safeParse({ lat: '41' }).success).toBe(false);
  });

  it('WGS84 disini reddeder', () => {
    expect(nearbyMarketsQuerySchema.safeParse({ lat: '91', lng: '29' }).success).toBe(false);
  });
});

describe('nearbyMarketListSchema', () => {
  it('bos liste gecerli: "bolgende market yok" bir hata degil', () => {
    expect(nearbyMarketListSchema.parse({ items: [] }).items).toEqual([]);
  });

  it('market ve mesafe tasir', () => {
    const parsed = nearbyMarketListSchema.parse({
      items: [{ market: MIGROS_MODA, distanceMeters: 228 }],
    });

    expect(parsed.items[0]?.distanceMeters).toBe(228);
  });
});

describe('kimlikler (ADR-15)', () => {
  it('katalog kimlikleri onekli ve okunabilir', () => {
    expect(marketIdSchema.safeParse('mkt_migros-jet-moda').success).toBe(true);
    expect(productIdSchema.safeParse('prd_sut-1l').success).toBe(true);
    expect(offerIdSchema.safeParse('ofr_migros-jet-moda-sut-1l').success).toBe(true);
  });

  it('yanlis onek, buyuk harf, bosluk ve cift tire reddedilir', () => {
    expect(marketIdSchema.safeParse('prd_sut-1l').success).toBe(false);
    expect(marketIdSchema.safeParse('mkt_Migros').success).toBe(false);
    expect(marketIdSchema.safeParse('mkt_migros jet').success).toBe(false);
    expect(marketIdSchema.safeParse('mkt_migros--jet').success).toBe(false);
    expect(marketIdSchema.safeParse('ds_kadikoy').success).toBe(false);
  });

  it('calisma aninda uretilen kimlik @getir/core bicimindedir, UUID DEGIL', () => {
    // Ilk surum UUID bekliyordu; core'un urettigi hicbir kimlik UUID degildi.
    expect(idSchema.safeParse('ord_db77f4c0e24f49919cc1d78a649c9c94').success).toBe(true);
    expect(idSchema.safeParse('9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f').success).toBe(false);
    expect(idSchema.safeParse('xyz_db77f4c0e24f49919cc1d78a649c9c94').success).toBe(false);
  });
});
