import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import {
  fetchMarketCategories,
  fetchMarketProducts,
  nextPageToken,
} from '../../src/features/catalog/api/market-catalog.api';
import { catalogKeys } from '../../src/features/catalog/api/query-keys';
import { fetchMarket, fetchNearbyMarkets } from '../../src/features/markets/api/markets.api';
import { marketKeys } from '../../src/features/markets/api/query-keys';
import { createHttpClient } from '../../src/shared/api/http-client';

const money = (amountMinor: number) => ({ amountMinor, currency: 'TRY' });

const market = {
  id: 'mkt_migros-jet-moda',
  name: 'Migros Jet – Moda',
  brand: 'Migros Jet',
  location: { lat: 40.98, lng: 29.03 },
  deliveryRadiusMeters: 2500,
  isOpen: true,
  deliveryTime: { minMinutes: 15, maxMinutes: 25 },
  rating: { average: 4.7, count: 1200 },
  pricingRules: {
    minBasket: money(4000),
    deliveryFee: money(1999),
    freeDeliveryThreshold: money(25_000),
  },
};

const product = {
  id: 'prd_sut-1l',
  offerId: 'ofr_migros-jet-moda-sut-1l',
  marketId: 'mkt_migros-jet-moda',
  sku: 'SUT-1L',
  name: 'Süt 1 L',
  categoryId: 'cat_sut-kahvaltilik',
  price: money(3490),
};

function clientReturning(data: unknown) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ success: true, data })));
  return { fetchMock, client: createHttpClient({ baseUrl: '', fetch: fetchMock }) };
}

const calledUrl = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string => {
  const input = fetchMock.mock.calls[0]?.[0];
  return typeof input === 'string' ? input : '';
};

describe('markets api', () => {
  it('konumu lat/lng sorgu parametresi olarak gonderir', async () => {
    const { fetchMock, client } = clientReturning({ items: [{ market, distanceMeters: 405 }] });

    const list = await fetchNearbyMarkets(client, { lat: 40.9885, lng: 29.0262 });

    expect(calledUrl(fetchMock)).toBe('/v1/markets?lat=40.9885&lng=29.0262');
    expect(list.items[0]?.market.rating.average).toBe(4.7);
  });

  it('market kimligini yola kodlayarak koyar', async () => {
    const { fetchMock, client } = clientReturning(market);

    await fetchMarket(client, 'mkt_a/b');

    expect(calledUrl(fetchMock)).toBe('/v1/markets/mkt_a%2Fb');
  });

  it('sozlesmeye uymayan market (onek yok) INTERNAL olur', async () => {
    const { client } = clientReturning({ ...market, id: 'migros' });
    await expect(fetchMarket(client, 'migros')).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });
});

describe('market catalog api', () => {
  it('kategorileri marketin yolundan ister', async () => {
    const { fetchMock, client } = clientReturning({ items: [] });

    await fetchMarketCategories(client, 'mkt_kardesler-manavi');

    expect(calledUrl(fetchMock)).toBe('/v1/markets/mkt_kardesler-manavi/categories');
  });

  it('urunlerde yalnizca DOLU filtreleri gonderir', async () => {
    const page = { items: [product], page: { nextPageToken: '', totalSize: 0 } };
    const first = clientReturning(page);
    await fetchMarketProducts(first.client, { marketId: 'mkt_x', pageSize: 20 });
    expect(calledUrl(first.fetchMock)).toBe('/v1/markets/mkt_x/products?pageSize=20');

    const filtered = clientReturning(page);
    await fetchMarketProducts(filtered.client, {
      marketId: 'mkt_x',
      categoryId: 'cat_sut-kahvaltilik',
      pageToken: 't1',
      pageSize: 20,
    });
    expect(calledUrl(filtered.fetchMock)).toBe(
      '/v1/markets/mkt_x/products?pageSize=20&categoryId=cat_sut-kahvaltilik&pageToken=t1',
    );
  });

  it('stok bilgisi olmayan urun sozlesmeye uyar (availableQuantity istege bagli)', async () => {
    const { client } = clientReturning({
      items: [product],
      page: { nextPageToken: '', totalSize: 0 },
    });

    const result = await fetchMarketProducts(client, { marketId: 'mkt_x', pageSize: 20 });

    expect(result.items[0]?.availableQuantity).toBeUndefined();
  });

  it('bos imlec listenin bittigi demektir', () => {
    expect(nextPageToken({ nextPageToken: '', totalSize: 0 })).toBeUndefined();
    expect(nextPageToken({ nextPageToken: 'abc', totalSize: 0 })).toBe('abc');
  });
});

describe('sorgu anahtarlari', () => {
  it('"tum urunler" ile kategorili liste ayri onbellek girdisidir', () => {
    expect(catalogKeys.marketProducts('mkt_x', undefined)).not.toEqual(
      catalogKeys.marketProducts('mkt_x', 'cat_a'),
    );
  });

  it('farkli konum farkli market listesi anahtari uretir', () => {
    expect(marketKeys.nearby({ lat: 1, lng: 2 })).not.toEqual(
      marketKeys.nearby({ lat: 1, lng: 3 }),
    );
  });
});
