/**
 * CategoryReader SOZLESME testi: ayni senaryolar bellekte (unit) ve gercek
 * Mongo'da (integration) kosar. Beklentiler demo verisine (fixtures.ts) goredir.
 */

import { describe, expect, it } from 'vitest';

import type { CategoryReader } from '../../src/domain/category-reader.js';

export function describeCategoryReaderContract(
  name: string,
  getReader: () => CategoryReader,
): void {
  describe(`CategoryReader sozlesmesi: ${name}`, () => {
    it('5 kategori doner', async () => {
      const categories = await getReader().listCategories();

      expect(categories.map((category) => category.slug).sort()).toEqual([
        'atistirmalik',
        'icecek',
        'meyve-sebze',
        'sut-kahvaltilik',
        'temizlik',
      ]);
    });

    it('gorsel yolu GORELI doner (mutlak URL gateway in isi)', async () => {
      const categories = await getReader().listCategories();

      expect(categories.every((category) => category.imageUrl.startsWith('/'))).toBe(true);
    });
  });
}
