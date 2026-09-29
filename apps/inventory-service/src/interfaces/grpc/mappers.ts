/** Use-case sonucu -> gRPC sozlesmesi. */

import type { inventoryV1 } from '@getir/proto';

import type { CheckAvailabilityResult } from '../../application/check-availability.js';

export function toCheckAvailabilityResponse(
  result: CheckAvailabilityResult,
): inventoryV1.CheckAvailabilityResponse {
  return {
    items: result.items.map(({ sku, availableQuantity }) => ({ sku, availableQuantity })),
    unknownSkus: [...result.unknownSkus],
  };
}
