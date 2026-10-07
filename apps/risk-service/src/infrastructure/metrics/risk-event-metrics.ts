/**
 * risk_events kaydinin metrikleri (#167): kayit karari bekletmeyince kayip
 * yalniz gunlukte kalmasin.
 *
 *  - risk_event_records_total{outcome}: kayit basina TEK nihai sonuc; toplami
 *    degerlendirme sayisidir. recorded (sinir icinde yazildi), late (sinirdan
 *    sonra arka planda yazildi), failed (dustu ya da kapanista yarim kaldi).
 *  - risk_event_record_timeouts_total: sure siniri asimi (karar kaydi
 *    beklemeden dondu); her biri sonra late ya da failed olur.
 *
 * NOT: kapanistaki `failed` artisi, service-kit /metrics'i kapanis kancasindan
 * once kapattigi icin okunmaz (bekleyen is #180); kalici sinyal error gunlugudur.
 *
 * Etiket kapali kumedir; kullanici ya da siparis etiket olmaz
 * (@getir/observability metrics/registry.ts).
 */

import { counter } from '@getir/observability';

import { RECORD_EVENT } from '../../application/evaluate-and-record.js';
import type { RecordEvent } from '../../application/evaluate-and-record.js';

export const RISK_EVENT_METRICS = {
  RECORDS: 'risk_event_records_total',
  TIMEOUTS: 'risk_event_record_timeouts_total',
} as const;

const records = counter<'outcome'>({
  name: RISK_EVENT_METRICS.RECORDS,
  help: 'risk_events kaydinin nihai sonucu: recorded, late, failed',
  labelNames: ['outcome'],
});

const timeouts = counter({
  name: RISK_EVENT_METRICS.TIMEOUTS,
  help: 'Sure sinirini asan (karar beklemeden donen) risk_events kayitlari',
});

export function recordRiskEvent(event: RecordEvent): void {
  if (event === RECORD_EVENT.TIMED_OUT) {
    timeouts.inc();
  } else {
    records.inc({ outcome: event });
  }
}
