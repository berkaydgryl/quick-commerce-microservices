/**
 * Use-case testi: bellek okuyuculariyla, Mongo/Docker/ag olmadan.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { createListProducts } from '../../src/application/list-products.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../src/domain/pagination.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';

const { offers, markets } = createInMemoryReaders();
const listProducts = createListProducts({ offers, markets });

describe('listProducts (ADR-15: bir marketin teklifleri)', () => {
  it('marketin tum tekliflerini varsayilan sayfa boyutuyla sayfalar', async () => {
    const page = await listProducts({ filter: { marketId: 'mkt_migros-jet-moda' } });

    expect(page.totalSize).toBe(15);
    expect(page.items).toHaveLength(Math.min(15, DEFAULT_PAGE_SIZE));
  });

  it('bilinmeyen market NOT_FOUND verir (bos liste DEGIL)', async () => {
    const failing = listProducts({ filter: { marketId: 'mkt_yok' } });

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('bilinen markette eslesme yoksa BOS liste doner, hata degil', async () => {
    const page = await listProducts({
      filter: { marketId: 'mkt_kardesler-manavi', categoryId: 'cat_temizlik' },
    });

    expect(page.items).toEqual([]);
    expect(page.totalSize).toBe(0);
  });

  it('sayfa boyutu ust sinirin uzerindeyse kirpilir', async () => {
    const page = await listProducts({
      filter: { marketId: 'mkt_migros-jet-moda' },
      pageSize: 5_000,
    });

    expect(page.items.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    expect(page.items).toHaveLength(15);
  });

  it('imlecle ikinci sayfa ayni kaydi vermez', async () => {
    const first = await listProducts({ filter: { marketId: 'mkt_migros-jet-moda' }, pageSize: 6 });
    const second = await listProducts({
      filter: { marketId: 'mkt_migros-jet-moda' },
      pageSize: 6,
      pageToken: first.nextPageToken,
    });

    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(12);
  });
});
