/**
 * Kurye atayan iscinin metrikleri (T13.1 PR 2).
 *
 *  - order_courier_dispatch_total{outcome}: siparis basina sonuc; outcome =
 *    assigned (kurye yazildi), no_courier (markette bos kurye yok, sonra
 *    yeniden), released (siparis atama sirasinda kapandi, kurye geri verildi).
 *  - order_courier_dispatch_errors_total{source}: atanamayan siparis,
 *    ulasilamadigi icin kesilen ya da hic yapilamayan tur; source = courier
 *    (courier-svc), store (siparis deposu), order (beklenmeyen, order'in
 *    kendisi). D1: depo arizasi "courier'e ulasilamiyor" gorunmez.
 *
 * Etiketler kucuk kumeler (uc deger): siparis, kurye ya da market kimligi
 * etiket olmaz (kural: @getir/observability metrics/registry.ts).
 */

import { counter } from '@getir/observability';

import { COURIER_STEP_OUTCOME, DISPATCH_SOURCE } from '../../application/assign-courier-step.js';
import type { DispatchSource } from '../../application/assign-courier-step.js';
import type { DispatchRound } from '../../application/dispatch-couriers.js';

export const ORDER_DISPATCHER_METRICS = {
  DISPATCHED: 'order_courier_dispatch_total',
  ERRORS: 'order_courier_dispatch_errors_total',
} as const;

const dispatched = counter<'outcome'>({
  name: ORDER_DISPATCHER_METRICS.DISPATCHED,
  help: 'Kurye istenen siparisler (sonuca gore)',
  labelNames: ['outcome'],
});

const errors = counter<'source'>({
  name: ORDER_DISPATCHER_METRICS.ERRORS,
  help: 'Kurye atanamayan siparisler, kesilen ve yapilamayan isci turlari (kaynaga gore)',
  labelNames: ['source'],
});

/** Tamamlanan tur: sonuclar etiketle; atanamayanlar ve kesilen tur kaynagiyla hata sayilir. */
export function recordDispatchRound(round: DispatchRound): void {
  dispatched.inc({ outcome: COURIER_STEP_OUTCOME.ASSIGNED }, round.assigned);
  dispatched.inc({ outcome: COURIER_STEP_OUTCOME.NO_COURIER }, round.noCourier);
  dispatched.inc({ outcome: COURIER_STEP_OUTCOME.RELEASED }, round.released);
  for (const source of Object.values(DISPATCH_SOURCE)) {
    const cut = round.unavailable === source ? 1 : 0;
    const count = round.failedBy[source] + cut;
    if (count > 0) {
      errors.inc({ source }, count);
    }
  }
}

/** Hic yapilamayan tur (tur beklenmedik bicimde hata firlatti). */
export function recordDispatchFailure(source: DispatchSource = DISPATCH_SOURCE.ORDER): void {
  errors.inc({ source });
}
