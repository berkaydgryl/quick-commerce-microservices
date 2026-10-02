/**
 * Giden cagri dayanikliligi metrikleri (D17): devre kesici ve yeniden deneme.
 *
 *  - grpc_client_breaker_state{target}: devrenin durumu (0 kapali, 1 yari acik,
 *    2 acik). Her gecis yazilir; acik kalan devre bagimli servisin dustugunu gosterir.
 *  - grpc_client_breaker_rejected_total{target}: devre acikken ag'a gitmeden
 *    reddedilen cagri.
 *  - grpc_client_retries_total{target}: yapilan yeniden deneme (ilk deneme sayilmaz).
 *
 * Etiket yalnizca `target`: bagimli servisin adi (kodda sabit, kapali liste).
 * Kimlik ya da istek verisi etiket olmaz (@getir/observability metrics/registry.ts).
 */

import { counter, gauge } from '@getir/observability';

export const CLIENT_METRICS = {
  BREAKER_STATE: 'grpc_client_breaker_state',
  BREAKER_REJECTED: 'grpc_client_breaker_rejected_total',
  RETRIES: 'grpc_client_retries_total',
} as const;

/** Gauge degeri: panoda "yukseldikce kotu" okunur. */
export const BREAKER_STATE_VALUE = {
  closed: 0,
  'half-open': 1,
  open: 2,
} as const;

const state = gauge<'target'>({
  name: CLIENT_METRICS.BREAKER_STATE,
  help: 'Devre kesicinin durumu: 0 kapali, 1 yari acik, 2 acik',
  labelNames: ['target'],
});

const rejected = counter<'target'>({
  name: CLIENT_METRICS.BREAKER_REJECTED,
  help: 'Devre acikken ag a gitmeden reddedilen cagrilar',
  labelNames: ['target'],
});

const retries = counter<'target'>({
  name: CLIENT_METRICS.RETRIES,
  help: 'Giden cagrilarin yeniden denemeleri (ilk deneme sayilmaz)',
  labelNames: ['target'],
});

export function recordBreakerState(target: string, value: keyof typeof BREAKER_STATE_VALUE): void {
  state.set({ target }, BREAKER_STATE_VALUE[value]);
}

export function recordBreakerRejection(target: string): void {
  rejected.inc({ target });
}

export function recordRetry(target: string): void {
  retries.inc({ target });
}
