import { useQuery } from '@tanstack/react-query';

import { authorizedClient } from '../../../shared/session/session';
import { orderTrackingQuery } from '../api/queries';
import type { TrackingMode } from '../api/queries';

/** Kurye takibi (F22): GET /v1/orders/{id}/tracking; yoklama ayarlari api/queries.ts'te. */
export function useOrderTracking(userId: string, orderId: string, mode: TrackingMode) {
  return useQuery(orderTrackingQuery(authorizedClient, userId, orderId, mode));
}
