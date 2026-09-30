/** Use-case sonucu -> gRPC sozlesmesi. */

import type { inventoryV1 } from '@getir/proto';

import type { CheckAvailabilityResult } from '../../application/check-availability.js';
import type { ReserveStockResult } from '../../application/reserve-stock.js';

export function toCheckAvailabilityResponse(
  result: CheckAvailabilityResult,
): inventoryV1.CheckAvailabilityResponse {
  return {
    items: result.items.map(({ sku, availableQuantity }) => ({ sku, availableQuantity })),
    unknownSkus: [...result.unknownSkus],
  };
}

export function toReserveResponse(result: ReserveStockResult): inventoryV1.ReserveResponse {
  return { expiresAt: result.expiresAt, alreadyReserved: result.alreadyReserved };
}
