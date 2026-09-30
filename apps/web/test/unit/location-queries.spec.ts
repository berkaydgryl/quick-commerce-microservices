/**
 * Konuma ve kullaniciya bagli sorgularin baglantisi (T9.5): konum ya da
 * kullanici yokken istek GITMEZ ve sorgu bekler; gelince TEK istek gider.
 * React'siz: sorgu ayarlari (api/queries.ts) uygulamanin QueryClient'iyla,
 * QueryObserver ve sahte fetch uzerinden sinanir. Tarayicida ayni akis canli
 * testte olculur (800 ms geciktirilen adres defteri).
 */

import type { GeoPoint } from '@getir/contracts';
import { ERROR_CODES } from '@getir/core';
import { QueryObserver } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../src/app/query-client';
import { savedAddressesQuery } from '../../src/features/address/api/queries';
import { addressBookState } from '../../src/features/address/services/delivery-address';
import { nearbyMarketsQuery } from '../../src/features/markets/api/queries';
import { marketKeys } from '../../src/features/markets/api/query-keys';
import { nearbySearchQuery } from '../../src/features/search/api/queries';
import { createHttpClient } from '../../src/shared/api/http-client';

const EV: GeoPoint = { lat: 40.9885, lng: 29.0262 };
const AYSE = 'usr_0123456789abcdef0123456789abcdef';

/** Her cagriya yeni cevap: govde bir kez okunur. */
function clientReturning(data: unknown) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, data }))),
    );
  return { fetchMock, http: createHttpClient({ baseUrl: '', fetch: fetchMock }) };
}

const calledUrls = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string[] =>
  fetchMock.mock.calls.map(([input]) => (typeof input === 'string' ? input : ''));

/** Bekleyen isler (abonelik, fetch baslatma) calissin. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const clients: QueryClient[] = [];
function queryClient(): QueryClient {
  const client = createQueryClient();
  clients.push(client);
  return client;
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe('yakindaki marketler sorgusu', () => {
  it('konum yokken istek gitmez ve sorgu bekler; konum gelince TEK istek o konumla', async () => {
    const { fetchMock, http } = clientReturning({ items: [] });
    const observer = new QueryObserver(queryClient(), nearbyMarketsQuery(http, undefined));
    const unsubscribe = observer.subscribe(() => undefined);

    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(observer.getCurrentResult()).toMatchObject({ status: 'pending', fetchStatus: 'idle' });

    observer.setOptions(nearbyMarketsQuery(http, EV));
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'));
    unsubscribe();

    expect(calledUrls(fetchMock)).toEqual(['/v1/markets?lat=40.9885&lng=29.0262']);
  });

  it('bekleyen sorgu onbellekteki baska konumun listesini GOSTERMEZ (oturumsuzken acilan Ev)', async () => {
    const { fetchMock, http } = clientReturning({ items: [] });
    const client = queryClient();
    client.setQueryData(marketKeys.nearby(EV), { items: [] });

    const observer = new QueryObserver(client, nearbyMarketsQuery(http, undefined));
    const unsubscribe = observer.subscribe(() => undefined);
    await settle();
    unsubscribe();

    expect(observer.getCurrentResult()).toMatchObject({ status: 'pending', data: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('genel arama sorgusu', () => {
  it('konum yokken istek gitmez; konum gelince TEK istek, arama ve konumla', async () => {
    const { fetchMock, http } = clientReturning({ items: [] });
    const observer = new QueryObserver(queryClient(), nearbySearchQuery(http, undefined, 'süt'));
    const unsubscribe = observer.subscribe(() => undefined);

    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(observer.getCurrentResult()).toMatchObject({ status: 'pending', fetchStatus: 'idle' });

    observer.setOptions(nearbySearchQuery(http, EV, 'süt'));
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'));
    unsubscribe();

    expect(calledUrls(fetchMock)).toEqual(['/v1/search?lat=40.9885&lng=29.0262&q=s%C3%BCt']);
  });
});

describe('adres defteri sorgusu', () => {
  it('kullanici yokken (oturumsuz) istek gitmez; kullanici gelince TEK istek', async () => {
    const { fetchMock, http } = clientReturning({ items: [] });
    const observer = new QueryObserver(queryClient(), savedAddressesQuery(http, null));
    const unsubscribe = observer.subscribe(() => undefined);

    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    observer.setOptions(savedAddressesQuery(http, AYSE));
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'));
    unsubscribe();

    expect(calledUrls(fetchMock)).toEqual(['/v1/me/addresses']);
    expect(observer.getCurrentResult().data).toEqual([]);
  });
});

describe('adres defteri: hatadan sonraki deneme', () => {
  const failure = () =>
    new Response(
      JSON.stringify({
        success: false,
        error: { code: ERROR_CODES.INTERNAL, message: 'Beklenmeyen hata', requestId: 'req_test' },
      }),
      { status: 500 },
    );

  it('TanStack denerken durumu "bekliyor"a ceker ve hatayi siler; addressBookState yine "okunamadi" der', async () => {
    let release: () => void = () => undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => Promise.resolve(failure()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(failure());
          }),
      );
    const http = createHttpClient({ baseUrl: '', fetch: fetchMock });
    const observer = new QueryObserver(queryClient(), savedAddressesQuery(http, AYSE));
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    expect(addressBookState(observer.getCurrentResult())).toBe('error');

    // "Tekrar dene" ya da sekme odagi: yeni deneme yolda.
    const retry = observer.refetch();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const during = observer.getCurrentResult();

    expect(during).toMatchObject({ status: 'pending', isError: false, error: null });
    expect(addressBookState(during)).toBe('error');

    release();
    await retry;
    unsubscribe();
    expect(addressBookState(observer.getCurrentResult())).toBe('error');
  });
});
