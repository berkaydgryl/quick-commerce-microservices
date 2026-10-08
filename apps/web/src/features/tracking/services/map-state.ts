/**
 * "Kuryem nerede" penceresinin icerigi (F22; QA K9 B2 ve code-review):
 * - son hata (404, yetki, gecersiz cevap) veriden yeniyse "alinamadi" (eski
 *   konum donmaz);
 * - gecici hata (503, ag) yoklama surerken "alinamadi" DEGIL: son cizim kalir,
 *   harita sokulmez, yakinlastirma korunur; veri yoksa "yukleniyor";
 * - yoklama yokken ('once') gecici hata da "alinamadi" ve "Tekrar dene" (takili
 *   kalmasin).
 * Hata, yeniden istek surerken de son yerlesen hatadir (useSettledError):
 * TanStack verisiz yeniden istekte hatayi null yapar; pencere titremez.
 */

import type { OrderTracking } from '@getir/contracts';

import { trackingErrorKind } from './tracking-errors';

export type CourierMapState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly tracking: OrderTracking };

export function courierMapState(query: {
  readonly data: OrderTracking | undefined;
  /** Son yerlesen hata (yeniden istek surerken de). */
  readonly error: unknown;
  readonly dataUpdatedAt: number;
  readonly errorUpdatedAt: number;
  /** Yoklama suruyor mu (acik pencerede 'open'; 'once'ta hayir). */
  readonly polling: boolean;
}): CourierMapState {
  const kind = trackingErrorKind(query.error);
  const errorNewer = query.data === undefined || query.errorUpdatedAt >= query.dataUpdatedAt;
  if (errorNewer && (kind === 'final' || (kind === 'transient' && !query.polling))) {
    return { kind: 'unavailable' };
  }
  return query.data === undefined ? { kind: 'loading' } : { kind: 'ready', tracking: query.data };
}
