/**
 * Kart silme (T11.17, QA C6): kart baska cihazda zaten silinmisse (404)
 * silme BASARI sayilir ve liste yeniden okunur; diger hatalar firlatilir.
 * Cevap gelirse guncel liste onbellege yazilir.
 */

import { QueryClient } from '@tanstack/react-query';
import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { cardKeys } from '../../src/features/cards/api/query-keys';
import { applyDeletedList, removeCard } from '../../src/features/cards/hooks/useDeleteCard';
import { createHttpClient } from '../../src/shared/api/http-client';

import { EXPIRED_AMEX, VISA_CARD } from './card-test-support';

const USER = 'usr_00000000000000000000000000000001';

const reply = (status: number, body: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
const failure = (code: string, status: number) =>
  reply(status, { success: false, error: { code, message: 'x', requestId: 'req_1' } });

function cache() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(cardKeys.list(USER), { items: [VISA_CARD, EXPIRED_AMEX] });
  return queryClient;
}

describe('kart silme (T11.17)', () => {
  it('basari: guncel liste doner ve onbellege yazilir', async () => {
    const client = createHttpClient({
      baseUrl: '',
      fetch: reply(200, { success: true, data: { items: [EXPIRED_AMEX] } }),
    });
    const queryClient = cache();

    const list = await removeCard(client, VISA_CARD.id, 'anahtar-1');
    await applyDeletedList(queryClient, USER, list);

    expect(queryClient.getQueryData(cardKeys.list(USER))).toEqual({ items: [EXPIRED_AMEX] });
    expect(queryClient.getQueryState(cardKeys.list(USER))?.isInvalidated).toBe(false);
  });

  it('QA C6: kart zaten silinmis (404) -> basari (null), liste yeniden okunur', async () => {
    const client = createHttpClient({ baseUrl: '', fetch: failure(ERROR_CODES.NOT_FOUND, 404) });
    const queryClient = cache();

    const list = await removeCard(client, VISA_CARD.id, 'anahtar-1');
    await applyDeletedList(queryClient, USER, list);

    expect(list).toBeNull();
    expect(queryClient.getQueryState(cardKeys.list(USER))?.isInvalidated).toBe(true);
  });

  it('diger hatalar firlatilir (silme olmadi)', async () => {
    const client = createHttpClient({
      baseUrl: '',
      fetch: failure(ERROR_CODES.SERVICE_UNAVAILABLE, 503),
    });

    await expect(removeCard(client, VISA_CARD.id, 'anahtar-1')).rejects.toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
  });
});
