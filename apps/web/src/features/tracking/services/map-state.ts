/**
 * "Kuryem nerede" penceresinin icerigi (F22 code-review): veri ve hata
 * ZAMANLARINDAN secilir. TanStack Query verisiz sorguyu yeniden isterken
 * hatayi null yapar; error'a bakmak pencereyi "yukleniyor" ile "alinamadi"
 * arasinda gidip getirirdi. Veriden yeni hata (ornek: rota birakildi, 404)
 * eski konumu dondurmaz, "alinamadi" gosterir.
 */

import type { OrderTracking } from '@getir/contracts';

export type CourierMapState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly tracking: OrderTracking };

export function courierMapState(query: {
  readonly data: OrderTracking | undefined;
  readonly dataUpdatedAt: number;
  readonly errorUpdatedAt: number;
}): CourierMapState {
  if (query.data !== undefined && query.dataUpdatedAt >= query.errorUpdatedAt) {
    return { kind: 'ready', tracking: query.data };
  }
  return query.errorUpdatedAt > 0 ? { kind: 'unavailable' } : { kind: 'loading' };
}
