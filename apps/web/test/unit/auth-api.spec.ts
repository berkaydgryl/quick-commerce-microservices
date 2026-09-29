import { describe, expect, it, vi } from 'vitest';

import {
  fetchProfile,
  loginUser,
  logoutSession,
  registerUser,
} from '../../src/features/auth/api/auth.api';
import { createHttpClient } from '../../src/shared/api/http-client';

import { sessionWith, success, USER } from './session-test-support';

function clientReturning(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  return { client: createHttpClient({ baseUrl: '', fetch: fetchMock }), fetchMock };
}

function sentRequest(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  const headers = new Headers(init?.headers);
  return {
    url,
    method: init?.method,
    body: init?.body,
    idempotencyKey: headers.get('Idempotency-Key'),
    authorization: headers.get('Authorization'),
  };
}

const CREDENTIALS = { phone: '+905550000001', password: 'Demo-Persona-2026' };

describe('kimlik uclari (T8.5)', () => {
  it('kayit: Idempotency-Key ve govdeyle POST /v1/auth/register', async () => {
    const { client, fetchMock } = clientReturning(success(sessionWith('j'), 201));

    const session = await registerUser(
      client,
      { ...CREDENTIALS, fullName: 'Ayşe Yılmaz' },
      'kayit-anahtari-1',
    );

    expect(session.accessToken).toBe('j');
    expect(sentRequest(fetchMock)).toEqual({
      url: '/v1/auth/register',
      method: 'POST',
      body: JSON.stringify({ ...CREDENTIALS, fullName: 'Ayşe Yılmaz' }),
      idempotencyKey: 'kayit-anahtari-1',
      authorization: null,
    });
  });

  it('giris: anahtarsiz POST /v1/auth/login, cevap oturum', async () => {
    const { client, fetchMock } = clientReturning(success(sessionWith('j')));

    await expect(loginUser(client, CREDENTIALS)).resolves.toMatchObject({ user: USER });
    expect(sentRequest(fetchMock)).toMatchObject({
      url: '/v1/auth/login',
      method: 'POST',
      body: JSON.stringify(CREDENTIALS),
      idempotencyKey: null,
    });
  });

  it('cevapta yenileme jetonu beklenmez: govdede refreshToken yok (ADR-12 eki)', async () => {
    const { client } = clientReturning(success(sessionWith('j')));

    const session = await loginUser(client, CREDENTIALS);

    expect(session).not.toHaveProperty('refreshToken');
  });

  it('cikis: govdesiz, anahtarsiz POST /v1/auth/logout', async () => {
    const { client, fetchMock } = clientReturning(success({ revoked: true }));

    await expect(logoutSession(client)).resolves.toEqual({ revoked: true });
    expect(sentRequest(fetchMock)).toMatchObject({
      url: '/v1/auth/logout',
      method: 'POST',
      body: undefined,
      idempotencyKey: null,
    });
  });

  it('profil: GET /v1/me', async () => {
    const { client, fetchMock } = clientReturning(success(USER));

    await expect(fetchProfile(client)).resolves.toEqual(USER);
    expect(sentRequest(fetchMock)).toMatchObject({ url: '/v1/me', method: 'GET' });
  });
});
