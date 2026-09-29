import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createHttpClient } from '../../src/shared/api/http-client';
import type { ApiRequest, HttpClient } from '../../src/shared/api/http-client';
import { createAuthorizedClient } from '../../src/shared/session/authorized-client';
import { createSessionLock } from '../../src/shared/session/session-lock';
import { refreshSession } from '../../src/shared/session/session-api';
import { createSessionRefresher } from '../../src/shared/session/session-refresher';
import type { SessionRefresher } from '../../src/shared/session/session-refresher';
import { createSessionStore } from '../../src/shared/session/session-store';

import { failure, sessionWith, success, USER } from './session-test-support';

const unauthorized = () => new AppError(ERROR_CODES.UNAUTHORIZED, 'x');

/** Sahte istemci: her istegin jetonunu kaydeder, cevaplari siradan verir. */
function scriptedClient(...outcomes: Array<unknown>) {
  const tokens: Array<string | undefined> = [];
  const request = vi.fn((_path: string, apiRequest: ApiRequest<unknown>) => {
    tokens.push(apiRequest.accessToken);
    const outcome = outcomes.shift();
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  });
  return { client: { request } as HttpClient, request, tokens };
}

function refresherReturning(...tokens: Array<string | null>) {
  const refresh = vi.fn(() => Promise.resolve(tokens.shift() ?? null));
  return { refresher: { refresh } satisfies SessionRefresher, refresh };
}

const schema = z.unknown();

describe('yetkili istemci (T8.5)', () => {
  it('istege bellekteki erisim jetonunu ekler', async () => {
    const { client, tokens } = scriptedClient('veri');
    const { refresher, refresh } = refresherReturning();
    const authorized = createAuthorizedClient({ client, accessToken: () => 'jeton', refresher });

    await expect(authorized.request('/v1/me', { schema })).resolves.toBe('veri');
    expect(tokens).toEqual(['jeton']);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('oturum yokken istek atmaz: UNAUTHORIZED', async () => {
    const { client, request } = scriptedClient();
    const { refresher } = refresherReturning();
    const authorized = createAuthorizedClient({ client, accessToken: () => null, refresher });

    await expect(authorized.request('/v1/me', { schema })).rejects.toMatchObject({
      code: ERROR_CODES.UNAUTHORIZED,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('401 -> bir kez yeniler -> yeni jetonla bir kez tekrarlar', async () => {
    const { client, tokens } = scriptedClient(unauthorized(), 'veri');
    const { refresher, refresh } = refresherReturning('yeni');
    let current = 'eski';
    refresh.mockImplementation(() => {
      current = 'yeni';
      return Promise.resolve('yeni');
    });
    const authorized = createAuthorizedClient({ client, accessToken: () => current, refresher });

    await expect(authorized.request('/v1/me', { schema })).resolves.toBe('veri');
    expect(tokens).toEqual(['eski', 'yeni']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('tekrarin 401i oldugu gibi doner: ikinci yenileme ve dongu yok', async () => {
    const second = unauthorized();
    const { client, request } = scriptedClient(unauthorized(), second);
    const { refresher, refresh } = refresherReturning('yeni');
    const authorized = createAuthorizedClient({ client, accessToken: () => 'eski', refresher });

    await expect(authorized.request('/v1/me', { schema })).rejects.toBe(second);
    expect(request).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('yenileme "oturum yok" derse ilk 401 doner, tekrar yapilmaz', async () => {
    const first = unauthorized();
    const { client, request } = scriptedClient(first);
    const { refresher } = refresherReturning(null);
    const authorized = createAuthorizedClient({ client, accessToken: () => 'eski', refresher });

    await expect(authorized.request('/v1/me', { schema })).rejects.toBe(first);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('401 disindaki hata yenilemeden doner', async () => {
    const notFound = new AppError(ERROR_CODES.NOT_FOUND, 'x');
    const { client } = scriptedClient(notFound);
    const { refresher, refresh } = refresherReturning();
    const authorized = createAuthorizedClient({ client, accessToken: () => 'jeton', refresher });

    await expect(authorized.request('/v1/x', { schema })).rejects.toBe(notFound);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('bu arada baska istek yenilediyse yeni jetonla tekrarlar, bir daha yenilemez', async () => {
    let current = 'eski';
    const { client, tokens } = scriptedClient(unauthorized(), 'veri');
    const request = client.request.bind(client);
    const racing: HttpClient = {
      request: async (path, apiRequest) => {
        const pending = request(path, apiRequest);
        current = 'baskasinin-yeniledigi'; // 401 gelmeden once diger istek yeniledi
        return pending;
      },
    };
    const { refresher, refresh } = refresherReturning();
    const authorized = createAuthorizedClient({
      client: racing,
      accessToken: () => current,
      refresher,
    });

    await expect(authorized.request('/v1/me', { schema })).resolves.toBe('veri');
    expect(tokens).toEqual(['eski', 'baskasinin-yeniledigi']);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('mutasyon ayni Idempotency-Key ile tekrarlanir', async () => {
    const { client, request } = scriptedClient(unauthorized(), 'veri');
    const { refresher } = refresherReturning('yeni');
    let current = 'eski';
    refresher.refresh.mockImplementation(() => {
      current = 'yeni';
      return Promise.resolve('yeni');
    });
    const authorized = createAuthorizedClient({ client, accessToken: () => current, refresher });

    await authorized.request('/v1/orders', {
      schema,
      method: 'POST',
      idempotencyKey: 'niyet-anahtari-1',
      body: { a: 1 },
    });

    const keys = request.mock.calls.map(([, apiRequest]) =>
      'idempotencyKey' in apiRequest ? apiRequest.idempotencyKey : undefined,
    );
    expect(keys).toEqual(['niyet-anahtari-1', 'niyet-anahtari-1']);
  });
});

describe('yetkili istemci gercek parcalarla (T8.5)', () => {
  it('suresi dolan jeton: /v1/me 401 -> /v1/auth/refresh -> /v1/me yeni jetonla', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(failure('UNAUTHORIZED', 401, { Authorization: 'suresi dolmus' }))
      .mockResolvedValueOnce(success(sessionWith('taze')))
      .mockResolvedValueOnce(success(USER));
    const http = createHttpClient({ baseUrl: '', fetch: fetchMock });
    const store = createSessionStore();
    store.getState().signIn(sessionWith('bayat'));
    const refresher = createSessionRefresher({
      refresh: () => refreshSession(http),
      session: store.getState(),
      lock: createSessionLock(undefined),
    });
    const authorized = createAuthorizedClient({
      client: http,
      accessToken: () => store.getState().accessToken,
      refresher,
    });

    await expect(authorized.request('/v1/me', { schema: z.unknown() })).resolves.toEqual(USER);

    const sent = fetchMock.mock.calls.map(([url, init]) => [
      url,
      new Headers(init?.headers).get('Authorization'),
    ]);
    expect(sent).toEqual([
      ['/v1/me', 'Bearer bayat'],
      ['/v1/auth/refresh', null],
      ['/v1/me', 'Bearer taze'],
    ]);
    expect(store.getState().accessToken).toBe('taze');
  });
});
