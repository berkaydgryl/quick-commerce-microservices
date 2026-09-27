/**
 * CategoryReader SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration) kosar. Beklentiler demo verisine (fixtures.ts) goredir.
 */

import { describe, expect, it } from 'vitest';

import { MAX_CATEGORY_COUNT } from '../../src/config/constants.js';
import type { CategoryReader } from '../../src/domain/category-reader.js';

export function describeCategoryReaderContract(
  name: string,
  getReader: () => CategoryReader,
): void {
  describe(`CategoryReader sozlesmesi: ${name}`, () => {
    it('5 kategori doner', async () => {
      const categories = await getReader().listCategories(MAX_CATEGORY_COUNT);

      expect(categories.map((category) => category.slug).sort()).toEqual([
        'atistirmalik',
        'icecek',
        'meyve-sebze',
        'sut-kahvaltilik',
        'temizlik',
      ]);
    });

    it('limit kadar keser; vitrin sirasinin (sortOrder) basindakiler kalir (D6)', async () => {
      const categories = await getReader().listCategories(2);

      expect(categories.map((category) => category.slug).sort()).toEqual([
        'meyve-sebze',
        'sut-kahvaltilik',
      ]);
    });

    it('gorsel yolu GORELI doner (mutlak URL gateway in isi)', async () => {
      const categories = await getReader().listCategories(MAX_CATEGORY_COUNT);

      expect(categories.every((category) => category.imageUrl.startsWith('/'))).toBe(true);
    });
  });
}
