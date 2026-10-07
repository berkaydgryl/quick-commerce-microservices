/**
 * Siparis supurucusunun metrikleri (T11.2 PR 2, karar 6a).
 *
 *  - order_sweeper_closed_total{status}: kilidi dolup kapatilan siparis;
 *    status = kapanmadan onceki durum (DRAFT, AWAITING_PAYMENT). Odeme bekleyen
 *    ve parasi alinmis siparisin iadesi de bu sayaca girer (gunlukte ayrica).
 *  - order_sweeper_completed_paid_total: kilidi dusmus gorunen ama stogu
 *    kesinlesmis, parasi alinmis siparis PAID yazildi (T15.3; bekleyen is 124).
 *    Ilk denemenin PAID yazamadigini gosterir; sifirdan buyukse izlenir.
 *  - order_sweeper_errors_total: kapatilamayan siparis (payment ya da depo
 *    hatasi) ve hic yapilamayan tur (siparisler okunamadi).
 *
 * Etiket yalnizca durum (iki deger): siparis ya da kullanici kimligi etiket
 * olmaz (kural: @getir/observability metrics/registry.ts).
 */

import { ORDER_STATUS } from '@getir/core';
import { counter } from '@getir/observability';

import type { SweepRound } from '../../application/sweep-expired-reservations.js';

export const ORDER_SWEEPER_METRICS = {
  CLOSED: 'order_sweeper_closed_total',
  COMPLETED_PAID: 'order_sweeper_completed_paid_total',
  ERRORS: 'order_sweeper_errors_total',
} as const;

const closed = counter<'status'>({
  name: ORDER_SWEEPER_METRICS.CLOSED,
  help: 'Kilidi dolup kapatilan siparisler (kapanmadan onceki duruma gore)',
  labelNames: ['status'],
});

const completedPaid = counter({
  name: ORDER_SWEEPER_METRICS.COMPLETED_PAID,
  help: 'Kilidi dusmus gorunen, stogu kesinlesmis ve parasi alinmis siparis PAID yazildi',
});

const errors = counter({
  name: ORDER_SWEEPER_METRICS.ERRORS,
  help: 'Kapatilamayan siparisler ve yapilamayan supurucu turlari',
});

/** Tamamlanan tur: kapatilanlar duruma gore, kapatilamayanlar hata sayilir. */
export function recordSweepRound(round: SweepRound): void {
  closed.inc({ status: ORDER_STATUS.DRAFT }, round.closedDrafts);
  closed.inc({ status: ORDER_STATUS.AWAITING_PAYMENT }, round.closedAwaitingPayment);
  completedPaid.inc(round.completedPaid);
  errors.inc(round.failed);
}

/** Hic yapilamayan tur (tur hata firlatti). */
export function recordSweepFailure(): void {
  errors.inc();
}
