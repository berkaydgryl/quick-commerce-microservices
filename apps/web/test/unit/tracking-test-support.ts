/** Kurye takibi testlerinin ornekleri (F22): uc asama, sozlesmenin asama kurallarina uyar. */

import { orderTrackingSchema } from '@getir/contracts';
import type { OrderTracking } from '@getir/contracts';

export const TRACKED_ORDER = 'ord_0000000000000000000000000000000b';
const COURIER = 'crr_0000000000000000000000000000000c';
const point = (index: number) => ({ lat: 40.98 + index / 1_000, lng: 29.02 + index / 1_000 });
const ROUTE = Array.from({ length: 8 }, (_, index) => point(index));

const base = {
  orderId: TRACKED_ORDER,
  courier: { id: COURIER, name: 'Mehmet Kaya' },
  at: '2026-10-07T21:00:00.000Z',
  route: ROUTE,
  marketLocation: point(0),
  deliveryLocation: point(7),
};

/** Paket alinmadan: konum yok, sure dakikaya yuvarli (gizlilik). */
export const TO_MARKET: OrderTracking = orderTrackingSchema.parse({
  ...base,
  status: 'PREPARING',
  phase: 'TO_MARKET',
  remainingMeters: 1_850,
  etaSeconds: 600,
});

/** Yolda: konum var, 1,2 km, ~8 dk. */
export const TO_CUSTOMER: OrderTracking = orderTrackingSchema.parse({
  ...base,
  status: 'ON_THE_WAY',
  phase: 'TO_CUSTOMER',
  location: point(3),
  remainingMeters: 1_234,
  etaSeconds: 451,
  pickedUpAt: '2026-10-07T20:58:00.000Z',
});

/** Yaklasti: kalan yol esikte (300 m). */
export const APPROACHING: OrderTracking = orderTrackingSchema.parse({
  ...base,
  status: 'ON_THE_WAY',
  phase: 'TO_CUSTOMER',
  location: point(6),
  remainingMeters: 280,
  etaSeconds: 70,
  pickedUpAt: '2026-10-07T20:58:00.000Z',
});

export const DELIVERED: OrderTracking = orderTrackingSchema.parse({
  ...base,
  status: 'DELIVERED',
  phase: 'DELIVERED',
  location: point(7),
  remainingMeters: 0,
  etaSeconds: 0,
  pickedUpAt: '2026-10-07T20:58:00.000Z',
  deliveredAt: '2026-10-07T21:06:00.000Z',
});
