/**
 * Pazaryeri sozlesmesi (ADR-15): market, yakindaki market listesi, genel arama
 * (T9.6) ve kimlikler.
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
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_RESULT_PRODUCTS_MAX,
  searchQuerySchema,
  searchResultListSchema,
  storeTypeSchema,
} from '../../src/index.js';

const TRY = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

const MIGROS_MODA = {
  id: 'mkt_migros-jet-moda',
  name: 'Migros Jet - Moda',
  brand: 'Migros Jet',
  logoUrl: 'https://cdn.example.com/img/market/migros-jet.png',
  storeType: 'MARKET',
  coverUrl: 'https://cdn.example.com/img/market/market.jpg',
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

  it('kapak GORELI yol olamaz; kapagi olmayan market gecerlidir (T11.11)', () => {
    const { coverUrl: _omitted, ...withoutCover } = MIGROS_MODA;

    expect(
      marketSchema.safeParse({ ...MIGROS_MODA, coverUrl: '/img/market/market.jpg' }).success,
    ).toBe(false);
    expect(marketSchema.safeParse(withoutCover).success).toBe(true);
  });

  it('dukkan turu yalnizca bilinen degerlerden biri; turu olmayan market gecerlidir', () => {
    const { storeType: _omitted, ...withoutType } = MIGROS_MODA;

    expect(marketSchema.safeParse({ ...MIGROS_MODA, storeType: 'BAKKAL' }).success).toBe(false);
    expect(marketSchema.safeParse(withoutType).success).toBe(true);
  });

  // Proto StoreType ve gateway ile esi: apps/gateway/internal/catalog/contract_test.go.
  it('dukkan turleri sabit sirada (T11.11)', () => {
    expect(storeTypeSchema.options).toEqual([
      'MARKET',
      'MANAV',
      'KASAP',
      'SARKUTERI',
      'KURUYEMIS',
      'FIRIN',
      'PETSHOP',
      'CICEKCI',
    ]);
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

  // Mesajlar govdedeki konumla ve gateway'in bicim kuraliyla (params.go) ayni.
  it.each([
    [{ lat: '91', lng: '29' }, 'lat', 'enlem -90 ile 90 arasinda olmali'],
    [{ lat: '41', lng: 'abc' }, 'lng', 'sayi olmali'],
    [{ lng: '29' }, 'lat', 'zorunlu'],
    // coerce bos metni 0 yapardi: "lat=" Gine Korfezi olarak islenirdi.
    [{ lat: '', lng: '29' }, 'lat', 'zorunlu'],
  ])('Turkce sebep: %o', (query, field, message) => {
    const issues = nearbyMarketsQuerySchema.safeParse(query).error?.issues ?? [];

    expect(issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      [field, message],
    ]);
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

describe('searchQuerySchema (T9.6 genel arama)', () => {
  it('konum sayiya cevrilir, arama kirpilir', () => {
    expect(searchQuerySchema.parse({ lat: '40.9885', lng: '29.0262', q: ' süt ' })).toEqual({
      lat: 40.9885,
      lng: 29.0262,
      q: 'süt',
    });
  });

  it('arama en fazla 64 karakter; sinir dahil (market ici aramayla ayni)', () => {
    const atLimit = 'a'.repeat(SEARCH_QUERY_MAX_LENGTH);

    expect(searchQuerySchema.safeParse({ lat: '41', lng: '29', q: atLimit }).success).toBe(true);
  });

  // Mesajlar catalog-service'in SearchNearby semasiyla ayni sema (D6).
  it.each([
    [{ lat: '41', lng: '29' }, 'q', 'zorunlu'],
    [{ lat: '41', lng: '29', q: '   ' }, 'q', 'zorunlu'],
    [{ lat: '41', lng: '29', q: ' s ' }, 'q', 'en az 2 karakter olmali'],
    [{ lat: '41', lng: '29', q: 'a'.repeat(65) }, 'q', 'en fazla 64 karakter olmali'],
    [{ lng: '29', q: 'süt' }, 'lat', 'zorunlu'],
  ])('Turkce sebep: %o', (query, field, message) => {
    const issues = searchQuerySchema.safeParse(query).error?.issues ?? [];

    expect(issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      [field, message],
    ]);
  });
});

describe('searchResultListSchema', () => {
  const SUT = {
    id: 'prd_sut-1l',
    offerId: 'ofr_migros-jet-moda-sut-1l',
    marketId: MIGROS_MODA.id,
    sku: 'SUT-1L',
    name: 'Süt 1 L',
    categoryId: 'cat_sut-kahvaltilik',
    price: TRY(3490),
    isActive: true,
    availableQuantity: 24,
  };
  const result = (overrides: Record<string, unknown> = {}) => ({
    market: MIGROS_MODA,
    distanceMeters: 405,
    marketNameMatched: false,
    products: [SUT],
    totalProductMatches: 2,
    ...overrides,
  });

  it('yakindaki market satiri + arama bilgisi: ilk urunler ve toplam', () => {
    const parsed = searchResultListSchema.parse({ items: [result()] });

    expect(parsed.items[0]?.distanceMeters).toBe(405);
    expect(parsed.items[0]?.products[0]?.availableQuantity).toBe(24);
    expect(parsed.items[0]?.totalProductMatches).toBe(2);
  });

  it('yalnizca adi eslesen market: urun listesi bos, toplam 0', () => {
    const parsed = searchResultListSchema.parse({
      items: [result({ marketNameMatched: true, products: [], totalProductMatches: 0 })],
    });

    expect(parsed.items[0]?.products).toEqual([]);
  });

  it('stok bilgisi olmayan urun gecerli (stok servisi cevap vermedi)', () => {
    const { availableQuantity: _omitted, ...withoutStock } = SUT;

    expect(
      searchResultListSchema.safeParse({ items: [result({ products: [withoutStock] })] }).success,
    ).toBe(true);
  });

  it('market basina en fazla SEARCH_RESULT_PRODUCTS_MAX urun', () => {
    const products = (count: number) => Array.from({ length: count }, () => SUT);

    expect(
      searchResultListSchema.safeParse({
        items: [result({ products: products(SEARCH_RESULT_PRODUCTS_MAX) })],
      }).success,
    ).toBe(true);
    expect(
      searchResultListSchema.safeParse({
        items: [result({ products: products(SEARCH_RESULT_PRODUCTS_MAX + 1) })],
      }).success,
    ).toBe(false);
  });

  // Her alan TEK TEK zorunlu: biri istege bagli olsa istemci "yok"u "false"
  // ya da "0" sanardi (ters kanitla goruldu: uc alan birlikte eksikken test
  // digerleri yuzunden kirmiziydi, marketNameMatched'i ayrica yakalamiyordu).
  it.each(['marketNameMatched', 'products', 'totalProductMatches'])(
    'arama bilgisi ZORUNLU: %s eksikse gecersiz',
    (field) => {
      const withoutField = Object.fromEntries(
        Object.entries(result()).filter(([key]) => key !== field),
      );

      expect(searchResultListSchema.safeParse({ items: [withoutField] }).success).toBe(false);
    },
  );

  it('bos liste gecerli: eslesme yok bir hata degil', () => {
    expect(searchResultListSchema.parse({ items: [] }).items).toEqual([]);
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
