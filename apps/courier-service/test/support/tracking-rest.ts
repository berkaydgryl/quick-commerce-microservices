/**
 * Takibin gateway'deki REST cevirisi (alan adlari sozlesmede ayni): testler
 * courier ciktisini @getir/contracts orderTrackingSchema'dan bununla gecirir.
 */

import type { OrderTracking } from '../../src/application/get-tracking.js';
import { TRACKING_PHASE } from '../../src/domain/route-progress.js';

const ORDER_STATUS_OF = {
  [TRACKING_PHASE.TO_MARKET]: 'PREPARING',
  [TRACKING_PHASE.TO_CUSTOMER]: 'ON_THE_WAY',
  [TRACKING_PHASE.DELIVERED]: 'DELIVERED',
} as const;

export function toRest(order: string, tracking: OrderTracking): unknown {
  return {
    orderId: order,
    status: ORDER_STATUS_OF[tracking.phase],
    phase: tracking.phase,
    courier: { id: tracking.courierId, name: tracking.courierName },
    ...(tracking.location === undefined ? {} : { location: tracking.location }),
    at: tracking.at.toISOString(),
    remainingMeters: tracking.remainingMeters,
    etaSeconds: tracking.etaSeconds,
    route: tracking.route,
    marketLocation: tracking.marketLocation,
    deliveryLocation: tracking.deliveryLocation,
    ...(tracking.pickedUpAt === undefined ? {} : { pickedUpAt: tracking.pickedUpAt.toISOString() }),
    ...(tracking.deliveredAt === undefined
      ? {}
      : { deliveredAt: tracking.deliveredAt.toISOString() }),
  };
}
