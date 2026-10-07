import {
  orderPlacementSchema,
  reservationReleaseSchema,
  reservationSchema,
} from '@getir/contracts';
import type {
  CreateOrderRequest,
  OrderPlacement,
  Reservation,
  ReservationRelease,
  ReserveCartRequest,
  ThreeDsRequest,
} from '@getir/contracts';

import type { HttpClient } from '../../../shared/api/http-client';

/** POST /v1/cart/reserve (T11.4): stok kilitlenir, siparisin kimligi doner. */
export function reserveCart(
  client: HttpClient,
  request: ReserveCartRequest,
  idempotencyKey: string,
): Promise<Reservation> {
  return client.request('/v1/cart/reserve', {
    method: 'POST',
    idempotencyKey,
    body: request,
    schema: reservationSchema,
  });
}

/** POST /v1/orders: kayitli kartla (cardId) ve siparis ayrintilariyla (details; B1/B2, order-request.ts). */
export function placeOrder(
  client: HttpClient,
  body: CreateOrderRequest,
  idempotencyKey: string,
): Promise<OrderPlacement> {
  return client.request('/v1/orders', {
    method: 'POST',
    idempotencyKey,
    body,
    schema: orderPlacementSchema,
  });
}

/** POST /v1/orders/{id}/3ds: her kod denemesi YENI anahtarla. Kod (otp) sirdir. */
export function confirmThreeDs(
  client: HttpClient,
  orderId: string,
  request: ThreeDsRequest,
  idempotencyKey: string,
): Promise<OrderPlacement> {
  return client.request(`/v1/orders/${encodeURIComponent(orderId)}/3ds`, {
    method: 'POST',
    idempotencyKey,
    body: request,
    schema: orderPlacementSchema,
  });
}

/** DELETE /v1/cart/reserve/{orderId} (T11.4): rezervasyonu ve odeme bekleyen siparisi birakir. */
export function releaseReservation(
  client: HttpClient,
  orderId: string,
  idempotencyKey: string,
): Promise<ReservationRelease> {
  return client.request(`/v1/cart/reserve/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
    idempotencyKey,
    schema: reservationReleaseSchema,
  });
}
