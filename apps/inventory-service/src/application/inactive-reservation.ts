/**
 * Uzatma ve kisaltmanin ortak hatasi (T11.3): aktif rezervasyon yok, kilit
 * dusmus. RESERVATION_EXPIRED (FAILED_PRECONDITION): cagiran (order) odeme
 * ALMAZ, siparisi iptal eder (inventory.proto ExtendReservation).
 */

import { AppError, ERROR_CODES } from '@getir/core';

import type { InactiveReservation } from '../domain/reservation.js';

export function reservationNotActive(
  where: { readonly orderId: string; readonly marketId: string },
  inactive: InactiveReservation,
): AppError {
  return new AppError(ERROR_CODES.RESERVATION_EXPIRED, 'Aktif rezervasyon yok', {
    details: { orderId: where.orderId, marketId: where.marketId, reason: inactive.reason },
  });
}
