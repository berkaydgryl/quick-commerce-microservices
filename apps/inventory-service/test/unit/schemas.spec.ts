import { describe, expect, it } from 'vitest';

import { MAX_AVAILABILITY_SKUS } from '../../src/config/constants.js';
import { checkAvailabilityRequestSchema } from '../../src/interfaces/grpc/schemas.js';

function problems(input: unknown): Record<string, string[] | undefined> {
  const result = checkAvailabilityRequestSchema.safeParse(input);
  return result.success ? {} : result.error.flatten().fieldErrors;
}

describe('CheckAvailability istek semasi', () => {
  it('gecerli istek: SKU lar kirpilir', () => {
    expect(
      checkAvailabilityRequestSchema.parse({ marketId: 'mkt_migros-jet-moda', skus: [' SUT-1L '] }),
    ).toEqual({ marketId: 'mkt_migros-jet-moda', skus: ['SUT-1L'] });
  });

  it('market zorunlu ve sozlesmenin biciminde', () => {
    expect(problems({ marketId: '', skus: [] }).marketId).toEqual(['zorunlu']);
    expect(problems({ marketId: 'migros', skus: [] }).marketId).toBeDefined();
  });

  it('deprecated dark_store_id okunmaz: market yerine gecmez, ciktiya girmez', () => {
    expect(problems({ darkStoreId: 'ds_kadikoy', marketId: '', skus: [] }).marketId).toEqual([
      'zorunlu',
    ]);
    const parsed = checkAvailabilityRequestSchema.parse({
      darkStoreId: 'ds_kadikoy',
      marketId: 'mkt_a101-caferaga',
      skus: [],
    });
    expect(Object.hasOwn(parsed, 'darkStoreId')).toBe(false);
  });

  it(`en fazla ${MAX_AVAILABILITY_SKUS} SKU; bos liste gecerli`, () => {
    const sku = (index: number): string => `SKU-${index}`;
    expect(problems({ marketId: 'mkt_a101-caferaga', skus: [] })).toEqual({});
    expect(
      problems({
        marketId: 'mkt_a101-caferaga',
        skus: Array.from({ length: MAX_AVAILABILITY_SKUS }, (_, i) => sku(i)),
      }),
    ).toEqual({});
    expect(
      problems({
        marketId: 'mkt_a101-caferaga',
        skus: Array.from({ length: MAX_AVAILABILITY_SKUS + 1 }, (_, i) => sku(i)),
      }).skus,
    ).toEqual([`en fazla ${MAX_AVAILABILITY_SKUS} sku`]);
  });

  it('bos SKU reddedilir; bicimi bozuk ama dolu SKU gecer (unknownSkus a duser)', () => {
    expect(problems({ marketId: 'mkt_a101-caferaga', skus: [''] }).skus).toBeDefined();
    expect(problems({ marketId: 'mkt_a101-caferaga', skus: ['sut 1l'] })).toEqual({});
  });
});
