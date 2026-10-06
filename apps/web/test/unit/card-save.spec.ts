/**
 * Kart kaydetme (T11.17, M7): numara ve CVV HICBIR onbellege girmez (sorgu
 * ve mutasyon onbellegi); listeye yalnizca maskeli cevap yazilir. Deneme
 * anahtari rastgele: sonucu belirsiz deneme (ag, 503; ilk istek suruyor 409
 * REQUEST_IN_PROGRESS, QA C1) ayni anahtarla tekrarlanir, cevap gelince
 * yenisi; belirsiz denemeden sonra ya da istek surerken form degisirse
 * yenisi (QA C3, D2).
 */

import { QueryClient } from '@tanstack/react-query';
import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { cardKeys } from '../../src/features/cards/api/query-keys';
import { saveCard } from '../../src/features/cards/hooks/useAddCard';
import { createAttemptKeys } from '../../src/features/cards/services/attempt-key';
import { createHttpClient } from '../../src/shared/api/http-client';

import { VISA_CARD, VISA_NUMBER } from './card-test-support';

const REQUEST = {
  number: VISA_NUMBER,
  expiryMonth: 8,
  expiryYear: 2029,
  cvv: '987',
  holderName: 'Ayşe Yılmaz',
};
const USER = 'usr_00000000000000000000000000000001';

const success = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
const failure = (code: string, status: number) =>
  new Response(
    JSON.stringify({ success: false, error: { code, message: 'x', requestId: 'req_1' } }),
    { status },
  );

function setup(responses: (() => Promise<Response>)[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockImplementationOnce(response);
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(cardKeys.list(USER), { items: [] });
  let next = 0;
  const attempts = createAttemptKeys(() => `anahtar-${(next += 1)}`);
  const client = createHttpClient({ baseUrl: '', fetch: fetchMock });
  const save = () => saveCard({ client, queryClient, userId: USER, attempts, request: REQUEST });
  const keys = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
  return { queryClient, save, keys, attempts };
}

/** Onbelleklerin tamami metin olarak: sorgular ve mutasyonlar. */
const cacheText = (queryClient: QueryClient) =>
  JSON.stringify([
    queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state),
    queryClient
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state),
  ]);

describe('kart kaydetme (T11.17, M7)', () => {
  it('liste onbellegine maskeli kart yazilir; numara ve CVV hicbir onbellekte yok', async () => {
    const { queryClient, save } = setup([
      () => Promise.resolve(success(VISA_CARD)),
      () => Promise.resolve(success({ items: [VISA_CARD] })),
    ]);

    expect(await save()).toEqual(VISA_CARD);

    const text = cacheText(queryClient);
    expect(text).toContain(VISA_CARD.id);
    expect(text).not.toContain(VISA_NUMBER);
    expect(text).not.toContain('"987"');
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('ag koptu (503): tekrar AYNI anahtarla; sonra basari', async () => {
    const { save, keys } = setup([
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.resolve(success(VISA_CARD)),
    ]);

    await expect(save()).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    await save();

    expect(keys()).toEqual(['anahtar-1', 'anahtar-1']);
  });

  it('sunucu reddetti (402): sonraki deneme YENI anahtar', async () => {
    const { save, keys } = setup([
      () => Promise.resolve(failure(ERROR_CODES.PAYMENT_DECLINED, 402)),
      () => Promise.resolve(success(VISA_CARD)),
    ]);

    await expect(save()).rejects.toBeInstanceOf(AppError);
    await save();

    expect(keys()).toEqual(['anahtar-1', 'anahtar-2']);
  });

  it('QA C1: ilk istek suruyor (409 REQUEST_IN_PROGRESS) -> tekrar AYNI anahtarla', async () => {
    const { save, keys } = setup([
      () => Promise.resolve(failure(ERROR_CODES.REQUEST_IN_PROGRESS, 409)),
      () => Promise.resolve(success(VISA_CARD)),
    ]);

    await expect(save()).rejects.toMatchObject({ code: ERROR_CODES.REQUEST_IN_PROGRESS });
    await save();

    expect(keys()).toEqual(['anahtar-1', 'anahtar-1']);
  });

  it('QA C3: belirsiz denemeden sonra form degisti -> YENI anahtar', async () => {
    const { save, keys, attempts } = setup([
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.resolve(success(VISA_CARD)),
    ]);

    await expect(save()).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    attempts.changed();
    await save();

    expect(keys()).toEqual(['anahtar-1', 'anahtar-2']);
  });

  it('form degisikligi korunan anahtar yokken anahtari degistirmez', () => {
    let next = 0;
    const attempts = createAttemptKeys(() => `anahtar-${(next += 1)}`);

    attempts.changed();
    attempts.changed();

    expect(attempts.start()).toBe('anahtar-1');
  });

  it('QA D2: istek surerken alan degisti, sonuc belirsiz -> sonraki deneme YENI anahtar', async () => {
    let edit = () => undefined as void;
    const { save, keys, attempts } = setup([
      () => {
        edit();
        return Promise.reject(new TypeError('Failed to fetch'));
      },
      () => Promise.resolve(success(VISA_CARD)),
    ]);
    edit = () => attempts.changed();

    await expect(save()).rejects.toMatchObject({ code: ERROR_CODES.SERVICE_UNAVAILABLE });
    await save();

    expect(keys()).toEqual(['anahtar-1', 'anahtar-2']);
  });

  it('anahtar govdeden turetilmez: numaradan ve CVV den bagimsiz', () => {
    const attempts = createAttemptKeys();
    const key = attempts.start();

    expect(key).not.toContain(VISA_NUMBER.slice(-4));
    expect(key).toMatch(/^[0-9A-Za-z_-]{8,128}$/);
  });
});
