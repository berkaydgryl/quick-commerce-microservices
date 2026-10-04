/**
 * Kurye atayan iscinin metrikleri (T13.1 PR 2).
 *
 *  - order_courier_dispatch_total{outcome}: siparis basina sonuc; outcome =
 *    assigned (kurye yazildi), no_courier (markette bos kurye yok, sonra
 *    yeniden), released (siparis atama sirasinda kapandi, kurye geri verildi).
 *  - order_courier_dispatch_errors_total: atanamayan siparis, courier-svc'ye
 *    ulasilamadigi icin kesilen tur ve hic yapilamayan tur.
 *
 * Etiket yalnizca sonuc (uc deger): siparis, kurye ya da market kimligi
 * etiket olmaz (kural: @getir/observability metrics/registry.ts).
 */

import { counter } from '@getir/observability';

import type { DispatchRound } from '../../application/dispatch-couriers.js';
import { COURIER_STEP_OUTCOME } from '../../application/assign-courier-step.js';

export const ORDER_DISPATCHER_METRICS = {
  DISPATCHED: 'order_courier_dispatch_total',
  ERRORS: 'order_courier_dispatch_errors_total',
} as const;

const dispatched = counter<'outcome'>({
  name: ORDER_DISPATCHER_METRICS.DISPATCHED,
  help: 'Kurye istenen siparisler (sonuca gore)',
  labelNames: ['outcome'],
});

const errors = counter({
  name: ORDER_DISPATCHER_METRICS.ERRORS,
  help: 'Kurye atanamayan siparisler, kesilen ve yapilamayan isci turlari',
});

/** Tamamlanan tur: sonuclar etiketle, atanamayanlar ve kesilen tur hata sayilir. */
export function recordDispatchRound(round: DispatchRound): void {
  dispatched.inc({ outcome: COURIER_STEP_OUTCOME.ASSIGNED }, round.assigned);
  dispatched.inc({ outcome: COURIER_STEP_OUTCOME.NO_COURIER }, round.noCourier);
  dispatched.inc({ outcome: COURIER_STEP_OUTCOME.RELEASED }, round.released);
  errors.inc(round.failed + (round.deferred > 0 ? 1 : 0));
}

/** Hic yapilamayan tur (tur hata firlatti). */
export function recordDispatchFailure(): void {
  errors.inc();
}
