import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createHttpClient } from '../../src/shared/api/http-client';

const schema = z.object({ ok: z.boolean() });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(fetchImpl: typeof fetch) {
  return createHttpClient({ baseUrl: 'http://gw.test', fetch: fetchImpl });
}

describe('http-client', () => {
  it('GET istegini kok adrese ekler ve zarfi acar', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ success: true, data: { ok: true } }));

    const data = await clientWith(fetchMock).request('/v1/x', { schema });

    expect(data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://gw.test/v1/x');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).has('Idempotency-Key')).toBe(false);
  });

  it('mutasyonda Idempotency-Key ve JSON govde gonderir', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ success: true, data: { ok: true } }));

    await clientWith(fetchMock).request('/v1/y', {
      schema,
      method: 'POST',
      idempotencyKey: 'anahtar-123',
      body: { a: 1 },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe('POST');
    expect(headers.get('Idempotency-Key')).toBe('anahtar-123');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe('{"a":1}');
  });

  it('4xx hata zarfini AppError olarak firlatir', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: 'VALIDATION_FAILED', message: 'Hatali', requestId: 'req_9' },
        },
        400,
      ),
    );

    await expect(clientWith(fetchMock).request('/v1/x', { schema })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      requestId: 'req_9',
    });
  });

  it('ag hatasini SERVICE_UNAVAILABLE yapar', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    const promise = clientWith(fetchMock).request('/v1/x', { schema });

    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
  });

  it('JSON olmayan cevabi (proxy HTML sayfasi) SERVICE_UNAVAILABLE yapar', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    await expect(clientWith(fetchMock).request('/v1/x', { schema })).rejects.toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
  });

  it('iptali (AbortError) cevirmeden gecirir', async () => {
    const abort = new DOMException('iptal', 'AbortError');
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(abort);

    await expect(clientWith(fetchMock).request('/v1/x', { schema })).rejects.toBe(abort);
  });
});
