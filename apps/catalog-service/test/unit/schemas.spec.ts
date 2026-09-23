import { describe, expect, it } from 'vitest';

import {
  getMarketRequestSchema,
  listNearbyMarketsRequestSchema,
  listProductsRequestSchema,
} from '../../src/interfaces/grpc/schemas.js';

describe('listProductsRequestSchema', () => {
  it('market ZORUNLU (ADR-15): proto3 bos metni "yok" sayilir ve reddedilir', () => {
    expect(listProductsRequestSchema.safeParse({ marketId: '' }).success).toBe(false);
    expect(listProductsRequestSchema.safeParse({}).success).toBe(false);
  });

  it('bos filtre metinlerini "filtre yok" sayar', () => {
    const parsed = listProductsRequestSchema.parse({
      marketId: 'mkt_a',
      categoryId: '',
      query: '',
    });

    expect(parsed).toEqual({
      marketId: 'mkt_a',
      categoryId: undefined,
      query: undefined,
      page: undefined,
    });
  });

  it('deprecated dark_store_id telde gelse de okunmaz', () => {
    const parsed = listProductsRequestSchema.parse({
      marketId: 'mkt_a',
      darkStoreId: 'ds_kadikoy',
    });

    expect(Object.hasOwn(parsed, 'darkStoreId')).toBe(false);
  });

  it('gercek degerleri kirparak alir', () => {
    const parsed = listProductsRequestSchema.parse({
      marketId: ' mkt_a ',
      categoryId: '  cat_1 ',
      query: ' süt ',
    });

    expect(parsed.marketId).toBe('mkt_a');
    expect(parsed.categoryId).toBe('cat_1');
    expect(parsed.query).toBe('süt');
  });

  it('tek harflik aramayi reddeder', () => {
    expect(() => listProductsRequestSchema.parse({ marketId: 'mkt_a', query: 'a' })).toThrow();
  });

  it('sayfa boyutunu REDDETMEZ; kirpma kurali domain katmanindadir', () => {
    const parsed = listProductsRequestSchema.parse({
      marketId: 'mkt_a',
      page: { pageSize: 5_000, pageToken: '' },
    });

    expect(parsed.page?.pageSize).toBe(5_000);
  });
});

describe('listNearbyMarketsRequestSchema', () => {
  it('konum ZORUNLU: (0,0) gibi islenmez', () => {
    expect(listNearbyMarketsRequestSchema.safeParse({}).success).toBe(false);
  });

  it('WGS84 disini reddeder', () => {
    expect(
      listNearbyMarketsRequestSchema.safeParse({ location: { lat: 91, lng: 29 } }).success,
    ).toBe(false);
  });
});

describe('getMarketRequestSchema', () => {
  it('bos market kimligini reddeder', () => {
    expect(getMarketRequestSchema.safeParse({ marketId: '  ' }).success).toBe(false);
  });
});
