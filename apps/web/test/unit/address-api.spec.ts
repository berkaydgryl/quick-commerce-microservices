/**
 * Adres defteri (T9.5): istek adresi, sozlesme dogrulamasi ve sorgu anahtari.
 * Jetonu yetkili istemci ekler (authorized-client.spec.ts); burada istemci
 * duz verilir.
 */

import { SAVED_ADDRESSES_MAX } from '@getir/contracts';
import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { fetchSavedAddresses } from '../../src/features/address/api/addresses.api';
import { addressKeys } from '../../src/features/address/api/query-keys';
import { createHttpClient } from '../../src/shared/api/http-client';

const EV = {
  id: 'adr_00000000000000000000000000000001',
  title: 'Ev',
  line: 'Caferağa Mah. Moda Cad. No:12, Kadıköy',
  location: { lat: 40.9885, lng: 29.0262 },
  note: 'Zil çalışmıyor, gelince arayın.',
};
const IS = {
  id: 'adr_00000000000000000000000000000002',
  title: 'İş',
  line: 'Sinanpaşa Mah. Barbaros Blv. No:40, Beşiktaş',
  location: { lat: 41.0431, lng: 29.0071 },
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

const calledMethod = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string | undefined =>
  fetchMock.mock.calls[0]?.[1]?.method;

describe('fetchSavedAddresses', () => {
  it('GET /v1/me/addresses; sira sunucunun (kayit sirasi, yeniden siralanmaz), not istege bagli', async () => {
    const { fetchMock, client } = clientReturning({ items: [IS, EV] });

    const list = await fetchSavedAddresses(client);

    expect(calledUrl(fetchMock)).toBe('/v1/me/addresses');
    expect(calledMethod(fetchMock)).toBe('GET');
    expect(list.items.map((address) => address.title)).toEqual(['İş', 'Ev']);
    expect(list.items[0]?.note).toBeUndefined();
    expect(list.items[1]?.note).toBe(EV.note);
  });

  it('adresi olmayan hesap bos liste, hata degil', async () => {
    const { client } = clientReturning({ items: [] });

    expect((await fetchSavedAddresses(client)).items).toEqual([]);
  });

  it.each([
    ['adin bos olmasi', { items: [{ ...EV, title: '  ' }] }],
    ['konumun olmamasi', { items: [{ title: 'Ev', line: EV.line }] }],
    [
      'SAVED_ADDRESSES_MAX ustu adres',
      { items: Array.from({ length: SAVED_ADDRESSES_MAX + 1 }, () => EV) },
    ],
  ])('sozlesmeye uymayan cevap INTERNAL olur: %s', async (_durum, data) => {
    const { client } = clientReturning(data);

    await expect(fetchSavedAddresses(client)).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });
});

describe('addressKeys', () => {
  it('defter kullaniciyla anahtarlanir: baska hesabin adresleri onbellekten gelmez', () => {
    expect(addressKeys.list('usr_a')).not.toEqual(addressKeys.list('usr_b'));
    expect(addressKeys.list('usr_a')).toEqual(addressKeys.list('usr_a'));
  });
});
