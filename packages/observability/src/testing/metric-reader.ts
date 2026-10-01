/**
 * Testte metrik okuma (T10.5): "bu cagri sayildi mi, hangi etiketle?" sorusu
 * surecin defterinden cevaplanir. Uretim kodu bunu kullanmaz.
 *
 * Testler defteri `metricsRegistry.resetMetrics()` ile sifirlayip mutlak deger
 * bekler; her test dosyasi ayri surecte kostugu icin dosyalar birbirini gormez.
 */

import { metricsRegistry } from '../metrics/registry.js';

export interface MetricSample {
  /** Ornegin adi: sayac ve gostergede metrigin adi; histogramda `_bucket`, `_sum`, `_count`. */
  readonly name: string;
  readonly labels: Readonly<Record<string, string | number | undefined>>;
  readonly value: number;
}

/** Metrigin butun ornekleri; metrik kayitli degilse bos dizi. */
export async function metricSamples(name: string): Promise<MetricSample[]> {
  const metric = metricsRegistry.getSingleMetric(name);
  if (metric === undefined) {
    return [];
  }
  const data = await metric.get();
  return data.values.map((sample) => ({
    name:
      'metricName' in sample && typeof sample.metricName === 'string' ? sample.metricName : name,
    labels: sample.labels,
    value: sample.value,
  }));
}

/**
 * Sayac ya da gostergenin, verilen etiketleri tasiyan orneklerinin toplami.
 * Hic ornek yoksa undefined (hic artmamis / hic ayarlanmamis).
 */
export async function metricValue(
  name: string,
  labels: Readonly<Record<string, string>> = {},
): Promise<number | undefined> {
  return sumOf((await metricSamples(name)).filter((sample) => matches(sample, labels)));
}

/** Histogramin, verilen etiketlerle kaydettigi gozlem sayisi (`_count`); yoksa undefined. */
export async function histogramCount(
  name: string,
  labels: Readonly<Record<string, string>> = {},
): Promise<number | undefined> {
  const counts = (await metricSamples(name)).filter(
    (sample) => sample.name === `${name}_count` && matches(sample, labels),
  );
  return sumOf(counts);
}

function matches(sample: MetricSample, labels: Readonly<Record<string, string>>): boolean {
  return Object.entries(labels).every(([key, value]) => String(sample.labels[key]) === value);
}

function sumOf(samples: readonly MetricSample[]): number | undefined {
  return samples.length === 0 ? undefined : samples.reduce((total, s) => total + s.value, 0);
}
