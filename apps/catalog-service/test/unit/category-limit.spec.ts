/**
 * D6: kategori listeleri sayfasizdir ("Sinirli listeler" istisnasi), bu yuzden
 * iki use-case de okumayi MAX_CATEGORY_COUNT ile sinirlamak ZORUNDADIR.
 * Okuyucu sinir almadan cagrilirsa tip hatasi olur; bu test sinirin DEGERINI
 * sabitler (yanlislikla baska bir sayi gecilmesin).
 */

import { describe, expect, it } from 'vitest';

import { createListCategories } from '../../src/application/list-categories.js';
import { createListMarketCategories } from '../../src/application/list-market-categories.js';
import { MAX_CATEGORY_COUNT } from '../../src/config/constants.js';
import type { Category } from '../../src/domain/catalog.js';
import type { CategoryReader } from '../../src/domain/category-reader.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';

class LimitRecordingReader implements CategoryReader {
  readonly limits: number[] = [];

  listCategories(limit: number): Promise<readonly Category[]> {
    this.limits.push(limit);
    return Promise.resolve([]);
  }
}

describe('kategori use-case leri okumayi sinirlar', () => {
  it('listCategories', async () => {
    const categories = new LimitRecordingReader();

    await createListCategories({ categories })();

    expect(categories.limits).toEqual([MAX_CATEGORY_COUNT]);
  });

  it('listMarketCategories', async () => {
    const categories = new LimitRecordingReader();
    const readers = createInMemoryReaders();

    await createListMarketCategories({ ...readers, categories })('mkt_migros-jet-moda');

    expect(categories.limits).toEqual([MAX_CATEGORY_COUNT]);
  });
});
