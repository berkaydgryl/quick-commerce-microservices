/**
 * Genel arama (T9.6): istek adresi, sozlesme dogrulamasi ve sorgu anahtari.
 */

import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { searchKeys } from '../../src/features/search/api/query-keys';
import { fetchNearbySearch } from '../../src/features/search/api/search.api';
import { createHttpClient } from '../../src/shared/api/http-client';

const EV = { lat: 40.9885, lng: 29.0262 };
const money = (amountMinor: number) => ({ amountMinor, currency: 'TRY' });

const market = {
  id: 'mkt_a101-caferaga',
  name: 'A101 – Caferağa',
  brand: 'A101',
  location: { lat: 40.99, lng: 29.03 },
  deliveryRadiusMeters: 2000,
  isOpen: true,
  deliveryTime: { minMinutes: 20, maxMinutes: 35 },
  rating: { average: 4.3, count: 800 },
  pricingRules: {
    minBasket: money(10_000),
    deliveryFee: money(1499),
    freeDeliveryThreshold: money(30_000),
  },
};

const sut = {
  id: 'prd_sut-1l',
  offerId: 'ofr_a101-caferaga-sut-1l',
  marketId: 'mkt_a101-caferaga',
  sku: 'SUT-1L',
  name: 'Süt 1 L',
  categoryId: 'cat_sut-kahvaltilik',
  price: money(3210),
  isActive: true,
  availableQuantity: 2,
};

const result = (overrides: Record<string, unknown> = {}) => ({
  market,
  distanceMeters: 216,
  marketNameMatched: false,
  products: [sut],
  totalProductMatches: 2,
  ...overrides,
});

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

describe('fetchNearbySearch', () => {
  it('konum ve arama sorgu parametresinde; Turkce karakter kodlanir', async () => {
    const { fetchMock, client } = clientReturning({ items: [result()] });

    const list = await fetchNearbySearch(client, EV, 'süt');

    expect(calledUrl(fetchMock)).toBe('/v1/search?lat=40.9885&lng=29.0262&q=s%C3%BCt');
    expect(list.items[0]?.distanceMeters).toBe(216);
    expect(list.items[0]?.products[0]?.availableQuantity).toBe(2);
  });

  it('bosluklu arama tek parametrede gider (kelimeleri sunucu ayirir)', async () => {
    const { fetchMock, client } = clientReturning({ items: [] });

    await fetchNearbySearch(client, EV, 'peynir beyaz');

    expect(new URL(calledUrl(fetchMock), 'http://x').searchParams.get('q')).toBe('peynir beyaz');
  });

  it('eslesme yoksa bos liste, hata degil', async () => {
    const { client } = clientReturning({ items: [] });

    expect((await fetchNearbySearch(client, EV, 'xyzq')).items).toEqual([]);
  });

  it('sozlesmeye uymayan cevap INTERNAL olur: arama bilgisi eksik', async () => {
    const { marketNameMatched: _omitted, ...withoutNameMatch } = result();
    const { client } = clientReturning({ items: [withoutNameMatch] });

    await expect(fetchNearbySearch(client, EV, 'süt')).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });

  it('sozlesmeye uymayan cevap INTERNAL olur: market basina 3 urunden fazlasi', async () => {
    const { client } = clientReturning({ items: [result({ products: [sut, sut, sut, sut] })] });

    await expect(fetchNearbySearch(client, EV, 'süt')).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });
});

describe('searchKeys', () => {
  it('arama metni anahtarda: yeni arama yeni sorgu, eskisinin istegi iptal edilir', () => {
    expect(searchKeys.nearby(EV, 'su')).not.toEqual(searchKeys.nearby(EV, 'sut'));
    expect(searchKeys.nearby(EV, 'sut')).toEqual(searchKeys.nearby({ ...EV }, 'sut'));
  });

  it('konum anahtarda: adres degisince (T9.5 PR 2) arama yeniden yapilir', () => {
    expect(searchKeys.nearby(EV, 'sut')).not.toEqual(
      searchKeys.nearby({ lat: 41.0431, lng: 29.0071 }, 'sut'),
    );
  });
});
