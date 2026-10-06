/**
 * Kart kasasi uclari (T11.17): istek adresi, yontem, Idempotency-Key ve
 * sozlesme dogrulamasi. Cevap maskelidir; sozlesme disi alan (tam numara
 * gibi) atilir.
 */

import { describe, expect, it, vi } from 'vitest';

import { addCard, deleteCard, fetchSavedCards } from '../../src/features/cards/api/cards.api';
import { cardKeys } from '../../src/features/cards/api/query-keys';
import { createHttpClient } from '../../src/shared/api/http-client';

import { VISA_CARD, VISA_NUMBER } from './card-test-support';

function clientReturning(data: unknown) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ success: true, data })));
  return { fetchMock, client: createHttpClient({ baseUrl: '', fetch: fetchMock }) };
}

const call = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) => {
  const [input, init] = fetchMock.mock.calls[0] ?? [];
  return {
    url: typeof input === 'string' ? input : '',
    method: init?.method,
    key: new Headers(init?.headers).get('Idempotency-Key'),
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
};

const REQUEST = {
  number: VISA_NUMBER,
  expiryMonth: 8,
  expiryYear: 2029,
  cvv: '123',
  holderName: 'Ayşe Yılmaz',
};

describe('kart uclari (T11.17)', () => {
  it('liste: GET /v1/me/cards', async () => {
    const { fetchMock, client } = clientReturning({ items: [VISA_CARD] });

    expect((await fetchSavedCards(client)).items).toEqual([VISA_CARD]);
    expect(call(fetchMock)).toMatchObject({ url: '/v1/me/cards', method: 'GET' });
  });

  it('ekleme: POST, anahtarla, govde istek; cevap maskeli kart, sozlesme disi alan atilir', async () => {
    const { fetchMock, client } = clientReturning({ ...VISA_CARD, number: VISA_NUMBER });

    const card = await addCard(client, REQUEST, 'anahtar-1');

    expect(call(fetchMock)).toEqual({
      url: '/v1/me/cards',
      method: 'POST',
      key: 'anahtar-1',
      body: REQUEST,
    });
    expect(card).toEqual(VISA_CARD);
    expect(JSON.stringify(card)).not.toContain(VISA_NUMBER);
  });

  it('silme: DELETE /v1/me/cards/{cardId}, anahtarla; cevap guncel liste', async () => {
    const { fetchMock, client } = clientReturning({ items: [] });

    expect((await deleteCard(client, VISA_CARD.id, 'anahtar-2')).items).toEqual([]);
    expect(call(fetchMock)).toMatchObject({
      url: `/v1/me/cards/${VISA_CARD.id}`,
      method: 'DELETE',
      key: 'anahtar-2',
    });
  });

  it('sorgu anahtari kullaniciya bagli', () => {
    expect(cardKeys.list('usr_1')).not.toEqual(cardKeys.list('usr_2'));
  });
});
