/**
 * E-posta dogrulama uclari (T11.14): istek adresi, yontem, anahtar, govde ve
 * sozlesme dogrulamasi; sunucunun alan cumlesi ve bekleme ayrintisi oldugu
 * gibi gelir. Jetonu yetkili istemci ekler; burada istemci duz verilir.
 */

import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { sendEmailCode, verifyEmail } from '../../src/features/profile/api/email.api';
import { createHttpClient } from '../../src/shared/api/http-client';

const USER_ID = 'usr_0123456789abcdef0123456789abcdef';
const REQUEST_ID = 'req_7f3c9a1e5b2d4c6f8a0b1c2d3e4f5a6b';

function clientAnswering(status: number, body: unknown) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  return { fetchMock, client: createHttpClient({ baseUrl: '', fetch: fetchMock }) };
}

const ok = (data: unknown) => ({ success: true, data });
const failure = (code: string, details: Record<string, unknown>) => ({
  success: false,
  error: { code, message: 'sozlukten', details, requestId: REQUEST_ID },
});

function callOf(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  const [input, init] = fetchMock.mock.calls[0] ?? [];
  return {
    url: typeof input === 'string' ? input : '',
    method: init?.method,
    headers: new Headers(init?.headers),
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

describe('sendEmailCode', () => {
  it('POST /v1/me/email/code: anahtar ve govde; cevap sureleri tasir', async () => {
    const sent = { email: 'ayse@ornek.com', expiresInSeconds: 600, resendAfterSeconds: 60 };
    const { fetchMock, client } = clientAnswering(202, ok(sent));

    const result = await sendEmailCode(client, { email: 'ayse@ornek.com' }, 'eposta-anahtari-01');

    const call = callOf(fetchMock);
    expect(call.url).toBe('/v1/me/email/code');
    expect(call.method).toBe('POST');
    expect(call.headers.get('Idempotency-Key')).toBe('eposta-anahtari-01');
    expect(call.body).toEqual({ email: 'ayse@ornek.com' });
    expect(result).toEqual(sent);
  });

  it('baska hesaptaki adres: email alanli VALIDATION_FAILED oldugu gibi gelir', async () => {
    const { client } = clientAnswering(
      400,
      failure('VALIDATION_FAILED', { email: 'Bu e-posta adresi başka bir hesapta kayıtlı' }),
    );

    await expect(
      sendEmailCode(client, { email: 'ayse@ornek.com' }, 'eposta-anahtari-01'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { email: 'Bu e-posta adresi başka bir hesapta kayıtlı' },
    });
  });

  it('erken yeniden gonderme: RATE_LIMITED ve kalan saniye', async () => {
    const { client } = clientAnswering(429, failure('RATE_LIMITED', { retryAfterSeconds: 42 }));

    await expect(
      sendEmailCode(client, { email: 'ayse@ornek.com' }, 'eposta-anahtari-01'),
    ).rejects.toMatchObject({ code: ERROR_CODES.RATE_LIMITED, details: { retryAfterSeconds: 42 } });
  });
});

describe('verifyEmail', () => {
  it('POST /v1/me/email/verify: adres ve kod; cevap e-postali profil', async () => {
    const profile = {
      id: USER_ID,
      phone: '+905321234567',
      fullName: 'Ayşe Yılmaz',
      email: 'ayse@ornek.com',
    };
    const { fetchMock, client } = clientAnswering(200, ok(profile));

    const result = await verifyEmail(
      client,
      { email: 'ayse@ornek.com', code: '042137' },
      'eposta-anahtari-02',
    );

    const call = callOf(fetchMock);
    expect(call.url).toBe('/v1/me/email/verify');
    expect(call.method).toBe('POST');
    expect(call.headers.get('Idempotency-Key')).toBe('eposta-anahtari-02');
    expect(call.body).toEqual({ email: 'ayse@ornek.com', code: '042137' });
    expect(result).toEqual(profile);
  });

  it('yanlis kod: code alanli VALIDATION_FAILED; cumle sunucudan', async () => {
    const { client } = clientAnswering(
      400,
      failure('VALIDATION_FAILED', { code: 'Kod hatalı. 4 deneme hakkın kaldı.' }),
    );

    await expect(
      verifyEmail(client, { email: 'ayse@ornek.com', code: '999999' }, 'eposta-anahtari-03'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      details: { code: 'Kod hatalı. 4 deneme hakkın kaldı.' },
    });
  });
});
