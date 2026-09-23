import { ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { fetchCategories } from '../../src/features/catalog/api/categories.api';
import { createHttpClient } from '../../src/shared/api/http-client';

const category = {
  id: 'cat_sut',
  name: 'Süt Ürünleri',
  slug: 'sut-urunleri',
  imageUrl: 'http://localhost:5173/img/cat/sut.png',
  sortOrder: 1,
};

function clientReturning(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
  return { fetchMock, client: createHttpClient({ baseUrl: '', fetch: fetchMock }) };
}

describe('fetchCategories', () => {
  it('GET /v1/categories cagirir ve listeyi sozlesmeyle dogrular', async () => {
    const { fetchMock, client } = clientReturning({ success: true, data: { items: [category] } });

    const list = await fetchCategories(client);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/categories');
    expect(list.items).toEqual([category]);
  });

  it('onekli olmayan kimlik sozlesme ihlalidir: INTERNAL', async () => {
    const { client } = clientReturning({
      success: true,
      data: { items: [{ ...category, id: 'sut' }] },
    });

    await expect(fetchCategories(client)).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL });
  });
});
