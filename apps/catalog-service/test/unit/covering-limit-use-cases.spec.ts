/**
 * ListNearbyMarkets ve SearchNearby ayni kapsayan marketleri gorur (#175): ikisi
 * de depodan kapsayanlari ayni sinirla alir. Bellek okuyuculari; Mongo karsiligi
 * test/integration/market-covering-limit.spec.ts.
 */

import { describe, expect, it } from 'vitest';

import { createListNearbyMarkets } from '../../src/application/list-nearby-markets.js';
import { createSearchNearby } from '../../src/application/search-nearby.js';
import { createInMemoryReaders } from '../../src/infrastructure/memory/in-memory-catalog.js';
import { CLASSIC_SNAPSHOT } from '../support/classic-catalog.js';
import { CROWDED_POINT, crowdedMarkets, WIDE_MARKET_ID } from '../support/crowded-markets.js';

const readers = createInMemoryReaders({
  ...CLASSIC_SNAPSHOT,
  markets: crowdedMarkets(),
  offers: [],
});

describe('aday siniri: ListNearbyMarkets ve SearchNearby tutarli (#175)', () => {
  it('genis yaricapli kapsayan market ikisinde de var; yakin kapsamayanlar ikisinde de yok', async () => {
    const listed = await createListNearbyMarkets(readers)(CROWDED_POINT);
    const wide = await createSearchNearby(readers)({ location: CROWDED_POINT, query: 'genis' });
    const near = await createSearchNearby(readers)({ location: CROWDED_POINT, query: 'yakin' });

    expect(listed.map((entry) => entry.market.id)).toEqual([WIDE_MARKET_ID]);
    expect(wide.map((result) => result.market.market.id)).toEqual([WIDE_MARKET_ID]);
    expect(near).toEqual([]);
  });
});
