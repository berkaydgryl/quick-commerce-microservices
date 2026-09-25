import { describe, expect, it } from 'vitest';

import {
  batchGetOffersRequestSchema,
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
      filter: { marketId: 'mkt_a' },
      pageSize: undefined,
      pageToken: undefined,
    });
    // exactOptionalPropertyTypes: bos filtre `undefined` degil, HIC yazilmaz.
    expect(Object.keys(parsed.filter)).toEqual(['marketId']);
  });

  it('ciktisi use-case girdisidir: filtre ic ice, sayfa duz', () => {
    const parsed = listProductsRequestSchema.parse({
      marketId: 'mkt_a',
      categoryId: 'cat_1',
      query: 'süt',
      page: { pageSize: 10, pageToken: 'imlec' },
    });

    expect(parsed).toEqual({
      filter: { marketId: 'mkt_a', categoryId: 'cat_1', query: 'süt' },
      pageSize: 10,
      pageToken: 'imlec',
    });
  });

  it('deprecated dark_store_id telde gelse de okunmaz', () => {
    const parsed = listProductsRequestSchema.parse({
      marketId: 'mkt_a',
      darkStoreId: 'ds_kadikoy',
    });

    expect(Object.hasOwn(parsed.filter, 'darkStoreId')).toBe(false);
  });

  it('gercek degerleri kirparak alir', () => {
    const parsed = listProductsRequestSchema.parse({
      marketId: ' mkt_a ',
      categoryId: '  cat_1 ',
      query: ' süt ',
    });

    expect(parsed.filter).toEqual({ marketId: 'mkt_a', categoryId: 'cat_1', query: 'süt' });
  });

  it('tek harflik aramayi reddeder', () => {
    expect(() => listProductsRequestSchema.parse({ marketId: 'mkt_a', query: 'a' })).toThrow();
  });

  it('sayfa boyutunu REDDETMEZ; kirpma kurali domain katmanindadir', () => {
    const parsed = listProductsRequestSchema.parse({
      marketId: 'mkt_a',
      page: { pageSize: 5_000, pageToken: '' },
    });

    expect(parsed.pageSize).toBe(5_000);
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

describe('batchGetOffersRequestSchema (T9.3 siniri)', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `prd_${index}`);
  const parse = (productIds: string[]) =>
    batchGetOffersRequestSchema.safeParse({ marketId: 'mkt_migros-jet-moda', productIds });

  it('tam 100 kimlik gecer, 101 reddedilir (sinir kaymasi testle yakalanir)', () => {
    expect(parse(ids(100)).success).toBe(true);
    const tooMany = parse(ids(101));
    expect(tooMany.success).toBe(false);
    expect(tooMany.error?.issues[0]?.path).toEqual(['productIds']);
  });

  it('50 kalemlik sepet gecer (T7.2 nin gonderecegi en buyuk sepet)', () => {
    expect(parse(ids(50)).success).toBe(true);
  });

  it('bos liste gecerlidir', () => {
    expect(parse([]).success).toBe(true);
  });

  it('bicimi bozuk ama dolu kimlik REDDEDILMEZ (missing e duser), bosluk kirpilir', () => {
    const result = parse(['  bozuk id!  ', 'prd_sut-1l']);
    expect(result.success).toBe(true);
    expect(result.data?.productIds).toEqual(['bozuk id!', 'prd_sut-1l']);
  });

  it('bos kimlik reddedilir', () => {
    expect(parse(['prd_sut-1l', '   ']).success).toBe(false);
  });
});
