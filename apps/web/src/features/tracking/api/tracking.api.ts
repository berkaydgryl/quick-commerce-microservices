/**
 * Kurye takibi okuma ucu (F22; T13.3 asama 1): GET /v1/orders/{id}/tracking.
 * Korumali; cevap sozlesmeyle (orderTrackingSchema, asama kurallari dahil)
 * dogrulanir. Takip yoksa (kurye atanmadi, rota birakildi) NOT_FOUND.
 */

import { orderTrackingSchema } from '@getir/contracts';
import type { OrderTracking } from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

export function fetchOrderTracking(
  client: HttpClient,
  orderId: string,
  signal?: AbortSignal,
): Promise<OrderTracking> {
  return client.request(`/v1/orders/${encodeURIComponent(orderId)}/tracking`, {
    schema: orderTrackingSchema,
    signal,
  });
}
