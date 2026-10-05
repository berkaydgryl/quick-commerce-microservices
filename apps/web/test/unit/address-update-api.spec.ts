/**
 * Adres duzenleme ve silme uclari (T11.15): yol (kimlik), yontem, anahtar,
 * govde ve cevabin sozlesmeyle dogrulanmasi. Jetonu yetkili istemci ekler;
 * burada istemci duz verilir.
 */

import type { UpdateAddressRequest } from '@getir/contracts';
import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import {
  deleteSavedAddress,
  updateSavedAddress,
} from '../../src/features/address/api/addresses.api';
import { createHttpClient } from '../../src/shared/api/http-client';

const ADDRESS_ID = 'adr_00000000000000000000000000000002';
const REQUEST: UpdateAddressRequest = {
  title: 'Ofis',
  kind: 'WORK',
  line: 'Levent, 34330 Beşiktaş/İstanbul, Türkiye',
  location: { lat: 41.08, lng: 29.01 },
};
const BOOK = { items: [{ ...REQUEST, id: ADDRESS_ID }] };

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

describe('updateSavedAddress (PUT)', () => {
  it('yol kimlikle, tam govde ve anahtar; cevap guncel defter', async () => {
    const { fetchMock, client } = clientAnswering(200, ok(BOOK));

    const book = await updateSavedAddress(client, ADDRESS_ID, REQUEST, 'duzenle-anahtar-01');

    const call = callOf(fetchMock);
    expect(call.url).toBe(`/v1/me/addresses/${ADDRESS_ID}`);
    expect(call.method).toBe('PUT');
    expect(call.headers.get('Idempotency-Key')).toBe('duzenle-anahtar-01');
    expect(call.body).toEqual(REQUEST);
    expect(book.items[0]).toMatchObject({ id: ADDRESS_ID, title: 'Ofis' });
  });

  it('baska adresin adi: alan ayrintili VALIDATION_FAILED oldugu gibi gelir', async () => {
    const { client } = clientAnswering(400, {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Girdiğin bilgilerde bir sorun var, kontrol eder misin?',
        details: { title: 'Bu adla kayıtlı bir adresin var' },
        requestId: 'req_7f3c9a1e5b2d4c6f8a0b1c2d3e4f5a6b',
      },
    });

    await expect(
      updateSavedAddress(client, ADDRESS_ID, REQUEST, 'duzenle-anahtar-02'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { title: 'Bu adla kayıtlı bir adresin var' },
    });
  });
});

describe('deleteSavedAddress (DELETE)', () => {
  it('govdesiz, anahtarli; cevap guncel defter', async () => {
    const { fetchMock, client } = clientAnswering(200, ok({ items: [] }));

    const book = await deleteSavedAddress(client, ADDRESS_ID, 'sil-anahtar-01');

    const call = callOf(fetchMock);
    expect(call.url).toBe(`/v1/me/addresses/${ADDRESS_ID}`);
    expect(call.method).toBe('DELETE');
    expect(call.headers.get('Idempotency-Key')).toBe('sil-anahtar-01');
    expect(call.body).toBeUndefined();
    expect(book.items).toEqual([]);
  });

  it('defterde olmayan adres NOT_FOUND', async () => {
    const { client } = clientAnswering(404, {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Aradığın kaydı bulamadık.',
        requestId: 'req_7f3c9a1e5b2d4c6f8a0b1c2d3e4f5a6b',
      },
    });

    await expect(deleteSavedAddress(client, ADDRESS_ID, 'sil-anahtar-02')).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('cevaptaki adres kimliksizse sozlesmeye uymaz (INTERNAL)', async () => {
    const { client } = clientAnswering(200, ok({ items: [REQUEST] }));

    await expect(deleteSavedAddress(client, ADDRESS_ID, 'sil-anahtar-03')).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });
});
