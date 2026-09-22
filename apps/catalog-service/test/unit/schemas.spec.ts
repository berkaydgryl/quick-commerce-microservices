import { describe, expect, it } from 'vitest';

import { listProductsRequestSchema } from '../../src/interfaces/grpc/schemas.js';

describe('listProductsRequestSchema', () => {
  it('proto3 varsayilani olan BOS METNI "filtre yok" sayar', () => {
    // Tel uzerinde set edilmeyen string alan, cozuldugunde '' olur.
    const parsed = listProductsRequestSchema.parse({ categoryId: '', darkStoreId: '', query: '' });

    expect(parsed).toEqual({
      categoryId: undefined,
      darkStoreId: undefined,
      query: undefined,
      page: undefined,
    });
  });

  it('gercek degerleri kirparak alir', () => {
    const parsed = listProductsRequestSchema.parse({ categoryId: '  cat_1 ', query: ' süt ' });

    expect(parsed.categoryId).toBe('cat_1');
    expect(parsed.query).toBe('süt');
  });

  it('tek harflik aramayi reddeder', () => {
    // Sozlesmedeki kural: en az 2 karakter.
    expect(() => listProductsRequestSchema.parse({ query: 'a' })).toThrow();
  });

  it('sayfa boyutunu REDDETMEZ; kirpma kurali domain katmanindadir', () => {
    const parsed = listProductsRequestSchema.parse({ page: { pageSize: 5_000, pageToken: '' } });

    expect(parsed.page?.pageSize).toBe(5_000);
  });
});
