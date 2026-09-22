import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { createSeedCatalog } from '../../src/application/seed-catalog.js';
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

    expect(counts).toEqual({ categories: 5, products: 15, darkStores: 2 });
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
});
