/**
 * Adres ekleme ve harita adres uclari (T11.8): istek adresi, yontem, anahtar,
 * govde ve sozlesme dogrulamasi. Jetonu yetkili istemci ekler; burada istemci
 * duz verilir.
 */

import { GEO_SEARCH_RESULTS_MAX } from '@getir/contracts';
import type { CreateAddressRequest } from '@getir/contracts';
import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { addSavedAddress } from '../../src/features/address/api/addresses.api';
import { reverseGeocode, searchPlaces } from '../../src/features/address/api/geo.api';
import { addressKeys } from '../../src/features/address/api/query-keys';
import { createHttpClient } from '../../src/shared/api/http-client';

const REQUEST: CreateAddressRequest = {
  title: 'Ev',
  kind: 'HOME',
  line: 'Osmanağa Mahallesi, Nail Bey Sokağı 23, 34710 Kadıköy/İstanbul, Türkiye',
  location: { lat: 40.9885, lng: 29.027 },
  building: '19C3',
  floor: '3',
};

function clientAnswering(status: number, body: unknown) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  return { fetchMock, client: createHttpClient({ baseUrl: '', fetch: fetchMock }) };
}

const ok = (data: unknown) => ({ success: true, data });

function callOf(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  const [input, init] = fetchMock.mock.calls[0] ?? [];
  return {
    url: typeof input === 'string' ? input : '',
    method: init?.method,
    headers: new Headers(init?.headers),
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

describe('addSavedAddress', () => {
  it('POST /v1/me/addresses: anahtar basligi ve govde; cevap guncel defter', async () => {
    const { fetchMock, client } = clientAnswering(201, ok({ items: [REQUEST] }));

    const book = await addSavedAddress(client, REQUEST, 'adres-anahtari-01');

    const call = callOf(fetchMock);
    expect(call.url).toBe('/v1/me/addresses');
    expect(call.method).toBe('POST');
    expect(call.headers.get('Idempotency-Key')).toBe('adres-anahtari-01');
    expect(call.body).toEqual(REQUEST);
    expect(book.items[0]).toMatchObject({ title: 'Ev', kind: 'HOME', building: '19C3' });
  });

  it('ayni ad: alan ayrintili VALIDATION_FAILED oldugu gibi gelir', async () => {
    const { client } = clientAnswering(400, {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Girdiğin bilgilerde bir sorun var, kontrol eder misin?',
        details: { title: 'Bu adla kayıtlı bir adresin var' },
        requestId: 'req_7f3c9a1e5b2d4c6f8a0b1c2d3e4f5a6b',
      },
    });

    await expect(addSavedAddress(client, REQUEST, 'adres-anahtari-01')).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { title: 'Bu adla kayıtlı bir adresin var' },
    });
  });
});

describe('reverseGeocode', () => {
  it('GET /v1/geo/reverse?lat=&lng=; satir doner', async () => {
    const { fetchMock, client } = clientAnswering(200, ok({ line: REQUEST.line }));

    const result = await reverseGeocode(client, REQUEST.location);

    expect(callOf(fetchMock).url).toBe('/v1/geo/reverse?lat=40.9885&lng=29.027');
    expect(result.line).toBe(REQUEST.line);
  });

  it('noktada adres yok: NOT_FOUND (satiri kullanici yazar)', async () => {
    const { client } = clientAnswering(404, {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Aradığın kaydı bulamadık.',
        requestId: 'req_7f3c9a1e5b2d4c6f8a0b1c2d3e4f5a6b',
      },
    });

    await expect(reverseGeocode(client, REQUEST.location)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});

describe('searchPlaces', () => {
  it('arama metni adreste kodlanir (Turkce harf, bosluk)', async () => {
    const { fetchMock, client } = clientAnswering(200, ok({ items: [] }));

    await searchPlaces(client, 'Bağdat Caddesi 34728');

    expect(callOf(fetchMock).url).toBe('/v1/geo/search?q=Ba%C4%9Fdat+Caddesi+34728');
  });

  it('GEO_SEARCH_RESULTS_MAX ustu sonuc sozlesmeye uymaz: INTERNAL', async () => {
    const place = { line: REQUEST.line, location: REQUEST.location };
    const { client } = clientAnswering(
      200,
      ok({ items: Array.from({ length: GEO_SEARCH_RESULTS_MAX + 1 }, () => place) }),
    );

    await expect(searchPlaces(client, 'Moda')).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });
});

describe('addressKeys (T11.8)', () => {
  it('ters cozum noktayla, arama metniyle anahtarlanir', () => {
    expect(addressKeys.reverse({ lat: 41, lng: 29 })).not.toEqual(
      addressKeys.reverse({ lat: 41, lng: 29.0001 }),
    );
    expect(addressKeys.search('Moda')).toEqual(addressKeys.search('Moda'));
    expect(addressKeys.search(undefined)).not.toEqual(addressKeys.search('Moda'));
  });
});
