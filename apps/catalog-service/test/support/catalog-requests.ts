/**
 * gRPC testlerinin ortak istek kaliplari. Market kimlikleri demo verisindendir
 * (src/infrastructure/fixtures).
 */

import type { catalogV1 } from '@getir/proto';

/** 15 teklifli, acik market; testlerin varsayilan marketi. */
export const MIGROS_MODA = 'mkt_migros-jet-moda';

/** proto3 bicimi: tum alanlar yazili, yalnizca degisenler verilir. */
export function listProductsRequest(
  overrides: Partial<catalogV1.ListProductsRequest> = {},
): catalogV1.ListProductsRequest {
  return {
    categoryId: '',
    darkStoreId: '',
    query: '',
    page: undefined,
    marketId: MIGROS_MODA,
    ...overrides,
  };
}
