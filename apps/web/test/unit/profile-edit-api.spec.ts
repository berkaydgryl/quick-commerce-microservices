/**
 * Profil duzenleme uclari (T11.14 PR 3): ad (PATCH /v1/me) ve telefon
 * (POST /v1/me/phone/code, /verify). Istek adresi, yontem, anahtar ve govde;
 * sunucunun alan cumleleri oldugu gibi gelir.
 */

import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import {
  sendPhoneCode,
  updateProfile,
  verifyPhone,
} from '../../src/features/profile/api/profile.api';
import { createHttpClient } from '../../src/shared/api/http-client';

const USER_ID = 'usr_0123456789abcdef0123456789abcdef';
const REQUEST_ID = 'req_7f3c9a1e5b2d4c6f8a0b1c2d3e4f5a6b';
const PROFILE = { id: USER_ID, phone: '+905321234567', fullName: 'Ayşe Kaya' };

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

describe('updateProfile', () => {
  it('PATCH /v1/me: anahtar ve ad; cevap guncel profil', async () => {
    const { fetchMock, client } = clientAnswering(200, ok(PROFILE));

    const profile = await updateProfile(client, { fullName: 'Ayşe Kaya' }, 'profil-anahtari-1');

    const call = callOf(fetchMock);
    expect([call.url, call.method]).toEqual(['/v1/me', 'PATCH']);
    expect(call.headers.get('Idempotency-Key')).toBe('profil-anahtari-1');
    expect(call.body).toEqual({ fullName: 'Ayşe Kaya' });
    expect(profile).toEqual(PROFILE);
  });
});

describe('sendPhoneCode', () => {
  it('POST /v1/me/phone/code: numara ve sifre; cevap sureler', async () => {
    const sent = { phone: '+905559876543', expiresInSeconds: 600, resendAfterSeconds: 60 };
    const { fetchMock, client } = clientAnswering(202, ok(sent));

    const result = await sendPhoneCode(
      client,
      { phone: '+905559876543', password: 'Demo-Sifre-2026' },
      'telefon-anahtari-1',
    );

    const call = callOf(fetchMock);
    expect([call.url, call.method]).toEqual(['/v1/me/phone/code', 'POST']);
    expect(call.body).toEqual({ phone: '+905559876543', password: 'Demo-Sifre-2026' });
    expect(result).toEqual(sent);
  });

  it('baska hesaptaki numara: PHONE_ALREADY_REGISTERED ve alan cumlesi', async () => {
    const { client } = clientAnswering(
      409,
      failure('PHONE_ALREADY_REGISTERED', { phone: 'Bu numara başka bir hesapta kayıtlı' }),
    );

    await expect(
      sendPhoneCode(client, { phone: '+905559876543', password: 'Demo-Sifre-2026' }, 'k-00000001'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PHONE_ALREADY_REGISTERED,
      details: { phone: 'Bu numara başka bir hesapta kayıtlı' },
    });
  });
});

describe('verifyPhone', () => {
  it('POST /v1/me/phone/verify: numara ve kod; cevap dogrulanmis profil', async () => {
    const verified = { ...PROFILE, phone: '+905559876543', phoneVerified: true };
    const { fetchMock, client } = clientAnswering(200, ok(verified));

    const profile = await verifyPhone(
      client,
      { phone: '+905559876543', code: '042137' },
      'k-00000002',
    );

    const call = callOf(fetchMock);
    expect([call.url, call.method]).toEqual(['/v1/me/phone/verify', 'POST']);
    expect(call.body).toEqual({ phone: '+905559876543', code: '042137' });
    expect(profile).toEqual(verified);
  });
});
