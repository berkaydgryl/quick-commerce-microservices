/** Use-case sonucu -> gRPC sozlesmesi. */

import { inventoryV1 } from '@getir/proto';

import type { CheckAvailabilityResult } from '../../application/check-availability.js';
import type { ExtendReservationResult } from '../../application/extend-reservation.js';
import type {
  ReservationResult,
  ReservationResultOutcome,
} from '../../application/reservation-result.js';
import type { ReserveStockResult } from '../../application/reserve-stock.js';
import type { ShortenReservationResult } from '../../application/shorten-reservation.js';

/** Use-case sonucu -> sozlesmedeki ReservationOutcome (Release ve Commit). */
const RESERVATION_OUTCOMES: Record<ReservationResultOutcome, inventoryV1.ReservationOutcome> = {
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

export function toReleaseResponse(result: ReservationResult): inventoryV1.ReleaseResponse {
  return { outcome: RESERVATION_OUTCOMES[result.outcome] };
}

export function toCommitResponse(result: ReservationResult): inventoryV1.CommitResponse {
  return { outcome: RESERVATION_OUTCOMES[result.outcome] };
}

export function toExtendResponse(
  result: ExtendReservationResult,
): inventoryV1.ExtendReservationResponse {
  return {
    expiresAt: result.expiresAt,
    alreadyExtended: result.alreadyExtended,
    extensionCount: result.extensionCount,
  };
}

export function toShortenResponse(
  result: ShortenReservationResult,
): inventoryV1.ShortenReservationResponse {
  return { expiresAt: result.expiresAt, shortened: result.shortened };
}
