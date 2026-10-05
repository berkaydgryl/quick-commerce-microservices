/**
 * Siparis okuma uclari (T11.16): GET /v1/orders (gecmis, imlecle) ve
 * GET /v1/orders/{id}; cevaplar sozlesmeyle dogrulanir, sorgu anahtarlari
 * kullaniciya baglidir.
 */

import { ORDER_HISTORY_PAGE_SIZE_DEFAULT } from '@getir/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  fetchOrder,
  fetchOrderHistory,
  nextHistoryPage,
} from '../../src/features/orders/api/orders.api';
import { orderKeys } from '../../src/features/orders/api/query-keys';
import { orderPath } from '../../src/features/orders/routes';
import { createHttpClient } from '../../src/shared/api/http-client';

import { ORDER, ORDER_ID, SUMMARY } from './order-test-support';

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

describe('fetchOrderHistory', () => {
  it('ilk sayfa: GET /v1/orders, sayfa boyu varsayilan, imlec yok', async () => {
    const { fetchMock, client } = clientReturning({
      items: [SUMMARY],
      page: { nextPageToken: 'imlec-2', totalSize: 0 },
    });

    const page = await fetchOrderHistory(client, undefined);

    expect(calledUrl(fetchMock)).toBe(`/v1/orders?pageSize=${ORDER_HISTORY_PAGE_SIZE_DEFAULT}`);
    expect(page.items).toEqual([SUMMARY]);
    expect(nextHistoryPage(page.page)).toBe('imlec-2');
  });

  it('sonraki sayfa imlecle; bos imlec listenin sonu', async () => {
    const { fetchMock, client } = clientReturning({
      items: [],
      page: { nextPageToken: '', totalSize: 0 },
    });

    const page = await fetchOrderHistory(client, 'a b+c');

    expect(calledUrl(fetchMock)).toBe(
      `/v1/orders?pageSize=${ORDER_HISTORY_PAGE_SIZE_DEFAULT}&pageToken=a+b%2Bc`,
    );
    expect(nextHistoryPage(page.page)).toBeUndefined();
  });

  it('sozlesme disi cevap (bilinmeyen durum) hata', async () => {
    const { client } = clientReturning({
      items: [{ ...SUMMARY, status: 'LOST' }],
      page: { nextPageToken: '', totalSize: 0 },
    });

    await expect(fetchOrderHistory(client, undefined)).rejects.toThrow();
  });
});

describe('fetchOrder', () => {
  it('GET /v1/orders/{id}: tam siparis', async () => {
    const { fetchMock, client } = clientReturning(ORDER);

    expect(await fetchOrder(client, ORDER_ID)).toEqual(ORDER);
    expect(calledUrl(fetchMock)).toBe(`/v1/orders/${ORDER_ID}`);
  });
});

describe('orderKeys ve orderPath', () => {
  it('anahtarlar kullaniciya bagli: baska hesabin siparisi onbellekten gelmez', () => {
    expect(orderKeys.history('usr_1')).not.toEqual(orderKeys.history('usr_2'));
    expect(orderKeys.detail('usr_1', ORDER_ID)).not.toEqual(orderKeys.detail('usr_2', ORDER_ID));
  });

  it('detay adresi kimligi kodlar', () => {
    expect(orderPath(ORDER_ID)).toBe(`/hesabim/siparislerim/${ORDER_ID}`);
    expect(orderPath('a/b')).toBe('/hesabim/siparislerim/a%2Fb');
  });
});
