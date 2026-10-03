import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { createSeedCatalog } from '../../src/application/seed-catalog.js';
import { MAX_CATEGORY_COUNT } from '../../src/config/constants.js';
import type { Category } from '../../src/domain/catalog.js';
import type { CatalogSeedWriter, CatalogSnapshot } from '../../src/domain/catalog-snapshot.js';
import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';

class RecordingWriter implements CatalogSeedWriter {
  readonly written: CatalogSnapshot[] = [];

  replaceAll(snapshot: CatalogSnapshot): Promise<void> {
    this.written.push(snapshot);
    return Promise.resolve();
  }
}

describe('seedCatalog', () => {
  it('snapshot i yazar ve sayilari dondurur', async () => {
    const writer = new RecordingWriter();
    const seed = createSeedCatalog({ writer, snapshot: CATALOG_SNAPSHOT, isProduction: false });

    const counts = await seed();

    expect(counts).toEqual({ categories: 13, products: 49, markets: 21, offers: 166 });
    expect(writer.written).toEqual([CATALOG_SNAPSHOT]);
  });

  it('production ortaminda HICBIR SEY yazmadan reddeder', async () => {
    const writer = new RecordingWriter();
    const seed = createSeedCatalog({ writer, snapshot: CATALOG_SNAPSHOT, isProduction: true });

    const failing = seed();

    await expect(failing).rejects.toBeInstanceOf(AppError);
    await expect(failing).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(writer.written).toEqual([]);
  });

  describe('kategori ust siniri (D6: okuma MAX_CATEGORY_COUNT ta kesilir)', () => {
    const [template] = CATALOG_SNAPSHOT.categories;
    const categories = (count: number): Category[] =>
      Array.from({ length: count }, (_, index) => ({
        ...(template as Category),
        id: `cat_kategori-${index}`,
        slug: `kategori-${index}`,
      }));
    const seedWith = (count: number, writer: RecordingWriter) =>
      createSeedCatalog({
        writer,
        snapshot: { ...CATALOG_SNAPSHOT, categories: categories(count) },
        isProduction: false,
      })();

    it('tam sinir kadar kategori yazilir', async () => {
      const writer = new RecordingWriter();

      await expect(seedWith(MAX_CATEGORY_COUNT, writer)).resolves.toMatchObject({
        categories: MAX_CATEGORY_COUNT,
      });
      expect(writer.written).toHaveLength(1);
    });

    it('fazlasi HICBIR SEY yazilmadan reddedilir: kesme sessizce kategori kaybettirmez', async () => {
      const writer = new RecordingWriter();

      await expect(seedWith(MAX_CATEGORY_COUNT + 1, writer)).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
        details: { categories: MAX_CATEGORY_COUNT + 1, max: MAX_CATEGORY_COUNT },
      });
      expect(writer.written).toEqual([]);
    });
  });
});
