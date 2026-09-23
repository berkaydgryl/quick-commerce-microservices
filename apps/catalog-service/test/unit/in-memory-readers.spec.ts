/**
 * Bellek okuyuculari (MOCK modu) sozlesme testlerinden gecer. Ayni testler
 * Mongo uygulamasinda test/integration/mongo-catalog.spec.ts icinde kosar.
 */

import { describe, expect, it } from 'vitest';

import { CATALOG_SNAPSHOT } from '../../src/infrastructure/fixtures.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import { describeCategoryReaderContract } from '../support/category-reader-contract.js';
import { describeDarkStoreReaderContract } from '../support/dark-store-reader-contract.js';
import { demoLocation } from '../support/demo-addresses.js';
import { describeProductReaderContract } from '../support/product-reader-contract.js';

const readers = createInMemoryReaders();

describeCategoryReaderContract('bellek', () => readers.categories);
describeProductReaderContract('bellek', () => readers.products);
describeDarkStoreReaderContract('bellek', () => readers.darkStores);

describe('bellek DarkStoreReader: kapali depo', () => {
  it('kapali depoyu da dondurur - acik/kapali karari domain in', async () => {
    // Onceki surumde bu test demo verisiyle yaziliydi; iki depo da acik
    // oldugu icin kapali depoyu HIC sinamiyordu. Burada gercekten kapali.
    const closed = createInMemoryReaders({
      ...CATALOG_SNAPSHOT,
      darkStores: CATALOG_SNAPSHOT.darkStores.map((store) =>
        store.id === 'ds_kadikoy' ? { ...store, isOpen: false } : store,
      ),
    });

    const [nearest] = await closed.darkStores.listDarkStoresByDistance(demoLocation('Ev'), 5);

    expect(nearest?.store).toMatchObject({ id: 'ds_kadikoy', isOpen: false });
  });
});
