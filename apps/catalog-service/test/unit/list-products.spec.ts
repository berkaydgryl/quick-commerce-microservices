/**
 * Use-case testi: sahte depo ile, Mongo/Docker/ag olmadan.
 * Repository arayuzunun domain'de olmasinin karsiligi tam olarak bu.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { createListProducts } from '../../src/application/list-products.js';
import { DEFAULT_PAGE_SIZE } from '../../src/domain/pagination.js';
import { InMemoryCatalogRepository } from '../../src/infrastructure/in-memory-catalog-repository.js';

const repository = new InMemoryCatalogRepository();
const listProducts = createListProducts({ repository });

describe('listProducts', () => {
  it('filtresiz cagride tum urunleri sayfalar', async () => {
    const page = await listProducts({ filter: {} });

    expect(page.totalSize).toBe(15);
    expect(page.items).toHaveLength(15);
    // 15 kayit, varsayilan sayfa 20: devam yok.
    expect(page.items.length).toBeLessThanOrEqual(DEFAULT_PAGE_SIZE);
    expect(page.nextPageToken).toBe('');
  });

  it('kategori filtresini uygular', async () => {
    const page = await listProducts({ filter: { categoryId: 'cat_2' } });

    expect(page.items.map((item) => item.categoryId)).toEqual(Array<string>(4).fill('cat_2'));
  });

  it('depo filtresi o depoda satilmayani eler', async () => {
    const page = await listProducts({ filter: { darkStoreId: 'ds_besiktas' } });

    expect(page.items.map((item) => item.id)).toEqual(['prd_01', 'prd_05', 'prd_09', 'prd_12']);
  });

  it('bilinmeyen depo NOT_FOUND verir (bos liste DEGIL)', async () => {
    // Sozlesme ayrimi: "depo secimi bozuldu" ile "urun yok" ayri ekranlardir.
    const failing = listProducts({ filter: { darkStoreId: 'ds_yok' } });

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('bilinen depoda eslesme yoksa BOS liste doner, hata degil', async () => {
    const page = await listProducts({
      filter: { darkStoreId: 'ds_besiktas', categoryId: 'cat_5' },
    });

    expect(page.items).toEqual([]);
    expect(page.totalSize).toBe(0);
  });

  it('arama ad ve aciklamada calisir', async () => {
    const page = await listProducts({ filter: { query: 'peynir' } });

    expect(page.items.map((item) => item.sku)).toEqual(['PEYNIR-500']);
  });

  it('imlecle sayfalar ve ayni kaydi iki kez vermez', async () => {
    const first = await listProducts({ filter: {}, pageSize: 6 });
    const second = await listProducts({ filter: {}, pageSize: 6, pageToken: first.nextPageToken });

    expect(first.items).toHaveLength(6);
    expect(second.items).toHaveLength(6);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(12);
  });

  it('sayfa boyutu ust sinirin uzerindeyse kirpilir', async () => {
    const page = await listProducts({ filter: {}, pageSize: 5_000 });

    expect(page.items).toHaveLength(15);
  });

  it('pasif urun listeden GIZLENMEZ (satista degil bilgisi istemcide gosterilir)', async () => {
    const page = await listProducts({ filter: { categoryId: 'cat_5' } });

    expect(page.items.some((item) => !item.isActive)).toBe(true);
  });
});
