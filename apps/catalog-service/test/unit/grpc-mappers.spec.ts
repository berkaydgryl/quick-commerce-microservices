/**
 * Domain -> proto cevirisi: ListProducts cevabi. Handler'dan cikarilan cevap
 * bicimi (deprecated products, teklifler, sayfa) burada tek basina sinanir.
 */

import { describe, expect, it } from 'vitest';

import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import { toListProductsResponse, toProtoOffer } from '../../src/interfaces/grpc/mappers.js';

const MIGROS = 'mkt_migros-jet-moda';
const PAGE_SIZE = 2;
const TOTAL_SIZE = 15;

describe('toListProductsResponse', () => {
  it('teklifleri ve sayfa bilgisini tasir; deprecated products bos (ADR-15)', async () => {
    const { offers } = createInMemoryReaders();
    const page = await offers.listOffers({ marketId: MIGROS }, { size: PAGE_SIZE, token: '' });

    const response = toListProductsResponse(page);

    expect(response.products).toEqual([]);
    expect(response.offers).toEqual(page.items.map(toProtoOffer));
    expect(response.offers).toHaveLength(PAGE_SIZE);
    expect(response.page).toEqual({ nextPageToken: page.nextPageToken, totalSize: TOTAL_SIZE });
    expect(response.page?.nextPageToken).not.toBe('');
  });

  it('bos sayfa: bos liste ve bos imlec, hata degil', () => {
    const response = toListProductsResponse({ items: [], nextPageToken: '', totalSize: 0 });

    expect(response).toEqual({
      products: [],
      offers: [],
      page: { nextPageToken: '', totalSize: 0 },
    });
  });
});
