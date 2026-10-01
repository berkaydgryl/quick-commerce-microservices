/**
 * Supurucunun metrikleri (T10.5, #12; T10.3 eki). Liderlik, tur suresi ve geri
 * verilen sayisi once yalnizca gunlukteydi.
 *
 *  - reservation_sweeper_leader: bu ornek lider mi (1/0); her turda yazilir.
 *    Butun orneklerin toplami 1 olmali: 0 ise kimse supurmuyor.
 *  - reservation_sweeper_round_duration_seconds: liderin supurme turunun suresi.
 *  - reservation_sweeper_expired_total: suresi dolup stogu geri verilen rezervasyon.
 *  - reservation_sweeper_pending_ledger: stogu dondu ama defter kaydi henuz
 *    yazilamamis (Mongo erisilemez) rezervasyon; sonraki turlarda tamamlanir.
 *  - reservation_sweeper_errors_total: dusen tur (orn. Redis erisilemez).
 *
 * Etiket yok: market ya da siparis kimligi etiket olmaz (kural:
 * @getir/observability metrics/registry.ts).
 */

import { counter, gauge, histogram } from '@getir/observability';

import type { SweepResult } from '../../application/sweep-expired.js';

export const SWEEPER_METRICS = {
  LEADER: 'reservation_sweeper_leader',
  DURATION: 'reservation_sweeper_round_duration_seconds',
  EXPIRED: 'reservation_sweeper_expired_total',
  PENDING_LEDGER: 'reservation_sweeper_pending_ledger',
  ERRORS: 'reservation_sweeper_errors_total',
} as const;

const leader = gauge({
  name: SWEEPER_METRICS.LEADER,
  help: 'Bu ornek supurucu lideri mi (1/0)',
});

const duration = histogram({
  name: SWEEPER_METRICS.DURATION,
  help: 'Liderin supurme turunun suresi (sn)',
});

const expired = counter({
  name: SWEEPER_METRICS.EXPIRED,
  help: 'Suresi dolup stogu geri verilen rezervasyonlar',
});

const pendingLedger = gauge({
  name: SWEEPER_METRICS.PENDING_LEDGER,
  help: 'Stogu donmus ama defter kaydi henuz yazilamamis rezervasyonlar',
});

const errors = counter({
  name: SWEEPER_METRICS.ERRORS,
  help: 'Dusen supurucu turlari',
});

export function recordLeadership(holding: boolean): void {
  leader.set(holding ? 1 : 0);
}

export function recordSweep(result: SweepResult, seconds: number): void {
  duration.observe(seconds);
  expired.inc(result.expired);
  pendingLedger.set(result.pending);
}

export function recordSweepFailure(): void {
  errors.inc();
}
