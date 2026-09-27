import { SEARCH_QUERY_MAX_LENGTH } from '@getir/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  batchGetOffersRequestSchema,
  getMarketRequestSchema,
  listMarketCategoriesRequestSchema,
  listNearbyMarketsRequestSchema,
  listProductsRequestSchema,
} from '../../src/interfaces/grpc/schemas.js';

/** Hatalari [alan, mesaj] ciftleri olarak okur: servis details'i bu bicimde doner. */
function issuesOf(schema: z.ZodTypeAny, input: unknown): [string, string][] {
  const result = schema.safeParse(input);
  return (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]);
}

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

  // D6: kurallar REST sozlesmesiyle AYNI (@getir/contracts). Onceki surumde bu
  // isteklerin hepsi kabul ediliyordu.
  it('arama en fazla 64 karakter; sinir dahil', () => {
    const atLimit = 'a'.repeat(SEARCH_QUERY_MAX_LENGTH);

    expect(listProductsRequestSchema.safeParse({ marketId: 'mkt_a', query: atLimit }).success).toBe(
      true,
    );
    expect(
      issuesOf(listProductsRequestSchema, { marketId: 'mkt_a', query: `${atLimit}a` }),
    ).toEqual([['query', 'en fazla 64 karakter olmali']]);
  });

  it('bicimi bozuk kategori BOS LISTE degil, dogrulama hatasi', () => {
    expect(issuesOf(listProductsRequestSchema, { marketId: 'mkt_a', categoryId: 'sut' })).toEqual([
      ['categoryId', 'cat_ onekli kimlik bekleniyor'],
    ]);
  });

  it('bicimi bozuk market NOT_FOUND degil, dogrulama hatasi', () => {
    expect(issuesOf(listProductsRequestSchema, { marketId: 'BAD!ID' })).toEqual([
      ['marketId', 'mkt_ onekli kimlik bekleniyor'],
    ]);
  });

  it('bos market "zorunlu" der, bicim hatasi gibi raporlanmaz', () => {
    expect(issuesOf(listProductsRequestSchema, { marketId: '' })).toEqual([
      ['marketId', 'zorunlu'],
    ]);
    expect(issuesOf(listProductsRequestSchema, {})).toEqual([['marketId', 'zorunlu']]);
  });

  it('64 karakterden uzun kimlik reddedilir (sozlesmedeki CATALOG_ID_MAX_LENGTH)', () => {
    const longId = `mkt_${'a'.repeat(61)}`;

    expect(listProductsRequestSchema.safeParse({ marketId: longId }).success).toBe(false);
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

  // D6: mesajlar REST zarfinin details alanina aynen gecer; Ingilizce olmamali.
  it('hata mesajlari Turkce', () => {
    expect(issuesOf(listNearbyMarketsRequestSchema, {})).toEqual([['location', 'zorunlu']]);
    expect(issuesOf(listNearbyMarketsRequestSchema, { location: { lat: 95, lng: 200 } })).toEqual([
      ['location.lat', 'enlem -90 ile 90 arasinda olmali'],
      ['location.lng', 'boylam -180 ile 180 arasinda olmali'],
    ]);
  });

  it('sonsuz deger reddedilir (gRPC double Infinity tasiyabilir)', () => {
    expect(
      listNearbyMarketsRequestSchema.safeParse({
        location: { lat: Number.POSITIVE_INFINITY, lng: 29 },
      }).success,
    ).toBe(false);
  });
});

describe.each([
  ['getMarketRequestSchema', getMarketRequestSchema],
  ['listMarketCategoriesRequestSchema', listMarketCategoriesRequestSchema],
])('%s', (_name, schema) => {
  it('bos market kimligini reddeder', () => {
    expect(issuesOf(schema, { marketId: '  ' })).toEqual([['marketId', 'zorunlu']]);
  });

  it('bicimi bozuk market kimligini reddeder (D6: 404 degil 400)', () => {
    expect(issuesOf(schema, { marketId: 'BAD!ID' })).toEqual([
      ['marketId', 'mkt_ onekli kimlik bekleniyor'],
    ]);
  });

  it('bicimi dogru kimligi kirparak alir', () => {
    expect(schema.parse({ marketId: ' mkt_migros-jet-moda ' })).toEqual({
      marketId: 'mkt_migros-jet-moda',
    });
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

  it('market kimligi ESNEK DEGIL: sozlesme bicimi (D6)', () => {
    expect(
      issuesOf(batchGetOffersRequestSchema, { marketId: 'migros', productIds: ['prd_sut-1l'] }),
    ).toEqual([['marketId', 'mkt_ onekli kimlik bekleniyor']]);
  });
});
