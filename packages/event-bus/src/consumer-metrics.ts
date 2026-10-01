/**
 * Tuketici metrikleri (T10.5, #12): olaylarin sonucu ve grubun gecikmesi.
 *
 *  - event_consumer_events_total{group, topic, outcome}: isleyiciye verilen ya
 *    da olu olaylara giden kayit; outcome handled | retry | dead. Grubun
 *    dinlemedigi konular (skipped) sayilmaz. topic grubun dinledigi konudur
 *    (kapali liste); konusu okunamayan kayit (kirpilmis, bozuk) `unknown`.
 *  - event_consumer_lag{group}: gruba henuz HIC teslim edilmemis kayit sayisi.
 *  - event_consumer_pending{group}: teslim edilmis ama onaylanmamis kayit sayisi
 *    (isleniyor, gecici hatadan sonra bekliyor ya da coken tuketicide kaldi).
 *
 * lag ve pending GRUP geneldir (XINFO GROUPS): ayni gruptaki her kopya ayni
 * degeri yazar; Prometheus'ta max ile okunur. Grup dongusu bunlari
 * GROUP_STATS_INTERVAL_MS'de bir tazeler.
 */

import { counter, gauge } from '@getir/observability';

import type { Settlement } from './dispatch.js';
import type { GroupStats } from './redis-stream-group.js';

export const CONSUMER_METRICS = {
  EVENTS: 'event_consumer_events_total',
  LAG: 'event_consumer_lag',
  PENDING: 'event_consumer_pending',
} as const;

/** Konusu okunamayan kaydin `topic` etiketi (kirpilmis ya da bozuk kayit). */
export const UNKNOWN_TOPIC = 'unknown';

/** Sayilan sonuclar: grubun dinlemedigi konu (skipped) sayilmaz. */
export type CountedOutcome = Exclude<Settlement['kind'], 'skipped'>;

const events = counter<'group' | 'topic' | 'outcome'>({
  name: CONSUMER_METRICS.EVENTS,
  help: 'Tuketicinin sonuclandirdigi olaylar; outcome: handled | retry | dead',
  labelNames: ['group', 'topic', 'outcome'],
});

const lag = gauge<'group'>({
  name: CONSUMER_METRICS.LAG,
  help: 'Gruba henuz teslim edilmemis olay sayisi (XINFO GROUPS lag)',
  labelNames: ['group'],
});

const pending = gauge<'group'>({
  name: CONSUMER_METRICS.PENDING,
  help: 'Gruba teslim edilmis ama onaylanmamis olay sayisi (XINFO GROUPS pending)',
  labelNames: ['group'],
});

export function recordSettlement(group: string, topic: string, outcome: CountedOutcome): void {
  events.inc({ group, topic, outcome });
}

/** lag hesaplanamadiysa (undefined) son deger yerinde kalir. */
export function recordGroupStats(group: string, stats: GroupStats): void {
  pending.set({ group }, stats.pending);
  if (stats.lag !== undefined) {
    lag.set({ group }, stats.lag);
  }
}
