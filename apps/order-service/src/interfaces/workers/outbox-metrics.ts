/**
 * Outbox yayincisinin metrikleri (T10.5, #12). Once yalnizca gunlukteydi:
 * "olaylar hatta gidiyor mu, takildi mi?" sorusu metrikle cevaplanir.
 *
 *  - outbox_events_published_total: hatta (stream:events) yayinlanan olay.
 *  - outbox_relay_errors_total: yarida kalan ya da hic yapilamayan tur
 *    (Redis'e yazilamadi, Mongo okunamadi).
 *  - outbox_lag_seconds: turun gordugu en eski yayinlanmamis olayin yasi;
 *    saglikli yayinda tur araliginin (0,5 sn) altinda kalir. Tur hic yapilamazsa
 *    son degerinde kalir (o zaman hata sayaci artar).
 *
 * Etiket yok: olay kimligi ya da siparis kimligi etiket olmaz (kural:
 * @getir/observability metrics/registry.ts).
 */

import { counter, gauge } from '@getir/observability';

import type { RelayRound } from '../../application/relay-outbox.js';

export const OUTBOX_METRICS = {
  PUBLISHED: 'outbox_events_published_total',
  ERRORS: 'outbox_relay_errors_total',
  LAG: 'outbox_lag_seconds',
} as const;

const MS_PER_SECOND = 1_000;

const published = counter({
  name: OUTBOX_METRICS.PUBLISHED,
  help: 'Outboxtan olay hattina yayinlanan olaylar',
});

const errors = counter({
  name: OUTBOX_METRICS.ERRORS,
  help: 'Yarida kalan ya da yapilamayan outbox turlari',
});

const lag = gauge({
  name: OUTBOX_METRICS.LAG,
  help: 'Turun gordugu en eski yayinlanmamis olayin yasi (sn)',
});

/** Tamamlanan tur: yayinlanan sayilir, gecikme yazilir; yarida kaldiysa hata sayilir. */
export function recordRelayRound(round: RelayRound): void {
  published.inc(round.published);
  lag.set(round.lagMs / MS_PER_SECOND);
  if (round.failed) {
    errors.inc();
  }
}

/** Hic yapilamayan tur (tur hata firlatti). */
export function recordRelayFailure(): void {
  errors.inc();
}
