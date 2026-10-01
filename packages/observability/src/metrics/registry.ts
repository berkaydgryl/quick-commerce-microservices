/**
 * Metrik kayit defteri (T10.5): surecin TEK defteri ve metrik ureticileri.
 *
 * Kutuphane @prometheus-io/client'tir: prom-client'in Prometheus
 * organizasyonundaki devami (prom-client Agustos 2026'da kullanimdan kalkti,
 * API ayni). Servisler ve paketler kutuphaneyi DOGRUDAN import etmez, buradaki
 * ureticileri kullanir: kutuphane tek yerde degisir.
 *
 * Defter kutuphanenin KURESEL defteridir: bu paket bir surece iki kez yuklense
 * de (orn. testte kaynak + dist) metrikler ayni deftere yazilir ve /metrics
 * hepsini gorur. Ureticiler ayni adla ikinci kez cagrilinca var olani doner.
 *
 * KURALLAR (proje kurallari, "Gozlemlenebilirlik"):
 *  - Ad onek tasimaz (`getir_` yok); servis ayrimi her metrikteki `service`
 *    etiketiyledir (setServiceLabel). Birim adin sonundadir: `_seconds`, `_total`.
 *  - Etiket degeri KAPALI bir kumeden gelir (RPC adi, hata kodu, olay konusu).
 *    Kimlik (siparis, kullanici, istek), telefon ya da adres ETIKET OLMAZ: her
 *    farkli deger yeni bir zaman serisi acar ve kisisel veri metrik deposuna sizar.
 */

import { collectDefaultMetrics, Counter, Gauge, Histogram, register } from '@prometheus-io/client';
import type { Registry } from '@prometheus-io/client';

export type { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';

/** Surecin metrik defteri; /metrics bunu yazar. */
export const metricsRegistry: Registry = register;

/**
 * Sure histogramlarinin kovalari (saniye): 5 ms - 10 sn. Hizli okuma (ms'ler)
 * ile ust sinira dayanan cagri (deadline 1-3 sn, kapanis 10 sn) ayni olcekte gorunur.
 */
export const DURATION_BUCKETS_SECONDS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/** Surec metrikleri acildiysa bu metrik kayitlidir (tekrar acmamak icin). */
const PROCESS_METRICS_PROBE = 'process_cpu_user_seconds_total';

export interface MetricDefinition<L extends string> {
  /** Prometheus adi: kucuk harf, alt cizgi, birim sonda (`_seconds`, `_total`). */
  readonly name: string;
  /** Metrigin ne saydigi; /metrics ciktisinda `# HELP` satiri. */
  readonly help: string;
  /** Etiket adlari; degerleri kapali bir kumeden gelmeli (dosya basi). */
  readonly labelNames?: readonly L[];
}

export interface HistogramDefinition<L extends string> extends MetricDefinition<L> {
  /** Verilmezse DURATION_BUCKETS_SECONDS. */
  readonly buckets?: readonly number[];
}

/**
 * Her metrige `service` etiketi ekler (servis basina bir kez; startGrpcServer
 * cagirir). Etiket cikti aninda eklenir: once tanimlanan metrik de alir.
 */
export function setServiceLabel(service: string): void {
  metricsRegistry.setDefaultLabels({ service });
}

/** Node surec metriklerini (CPU, bellek, olay dongusu gecikmesi, GC) acar; ikinci cagri bir sey yapmaz. */
export function enableProcessMetrics(): void {
  if (metricsRegistry.getSingleMetric(PROCESS_METRICS_PROBE) === undefined) {
    collectDefaultMetrics({ register: metricsRegistry });
  }
}

/** Sayac: yalnizca artar (istek, olay, hata sayisi). */
export function counter<L extends string = never>(definition: MetricDefinition<L>): Counter<L> {
  const existing = metricsRegistry.getSingleMetric(definition.name);
  if (existing instanceof Counter) {
    return existing;
  }
  return new Counter({ ...base(definition), registers: [metricsRegistry] });
}

/** Gosterge: anlik deger (liderlik, gecikme, bekleyen sayisi). */
export function gauge<L extends string = never>(definition: MetricDefinition<L>): Gauge<L> {
  const existing = metricsRegistry.getSingleMetric(definition.name);
  if (existing instanceof Gauge) {
    return existing;
  }
  return new Gauge({ ...base(definition), registers: [metricsRegistry] });
}

/** Histogram: dagilim (sure). Kovalar verilmezse DURATION_BUCKETS_SECONDS. */
export function histogram<L extends string = never>(
  definition: HistogramDefinition<L>,
): Histogram<L> {
  const existing = metricsRegistry.getSingleMetric(definition.name);
  if (existing instanceof Histogram) {
    return existing;
  }
  return new Histogram({
    ...base(definition),
    buckets: [...(definition.buckets ?? DURATION_BUCKETS_SECONDS)],
    registers: [metricsRegistry],
  });
}

function base<L extends string>(
  definition: MetricDefinition<L>,
): { name: string; help: string; labelNames: readonly L[] } {
  return { name: definition.name, help: definition.help, labelNames: definition.labelNames ?? [] };
}
