/** Use-case sonucu -> gRPC sozlesmesi. */

import { inventoryV1 } from '@getir/proto';

import type { CheckAvailabilityResult } from '../../application/check-availability.js';
import type {
  ReleaseReservationResult,
  ReleaseResultOutcome,
} from '../../application/release-reservation.js';
import type { ReserveStockResult } from '../../application/reserve-stock.js';

/** Use-case sonucu -> sozlesmedeki ReservationOutcome (Commit de kullanacak, PR 2). */
const RESERVATION_OUTCOMES: Record<ReleaseResultOutcome, inventoryV1.ReservationOutcome> = {
  applied: inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_APPLIED,
  'already-applied': inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_ALREADY_APPLIED,
  'not-found': inventoryV1.ReservationOutcome.RESERVATION_OUTCOME_NOT_FOUND,
};

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

export function toReleaseResponse(result: ReleaseReservationResult): inventoryV1.ReleaseResponse {
  return { outcome: RESERVATION_OUTCOMES[result.outcome] };
}
