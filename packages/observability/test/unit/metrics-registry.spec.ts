/**
 * Metrik defteri ve ureticiler (T10.5): ayni adla ikinci tanim var olani doner,
 * `service` etiketi her metrige eklenir, surec metrikleri bir kez acilir.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  counter,
  DURATION_BUCKETS_SECONDS,
  enableProcessMetrics,
  gauge,
  histogram,
  metricsRegistry,
  setServiceLabel,
} from '../../src/metrics/registry.js';
import { histogramCount, metricSamples, metricValue } from '../../src/testing/index.js';

beforeEach(() => {
  metricsRegistry.resetMetrics();
});

describe('metrik ureticileri', () => {
  it('ayni adla ikinci tanim AYNI metrigi doner (paket iki kez yuklense de tek seri)', () => {
    const first = counter({ name: 'deneme_tekil_total', help: 'h', labelNames: ['rpc'] });
    const second = counter({ name: 'deneme_tekil_total', help: 'h', labelNames: ['rpc'] });

    expect(second).toBe(first);
    expect(gauge({ name: 'deneme_gosterge', help: 'h' })).toBe(
      gauge({ name: 'deneme_gosterge', help: 'h' }),
    );
  });

  it('ayni ad baska turde tanimlanirsa hata verir (sessizce iki anlam olmaz)', () => {
    counter({ name: 'deneme_cakisan', help: 'h' });

    expect(() => gauge({ name: 'deneme_cakisan', help: 'h' })).toThrow(/already been registered/);
  });

  it('sayac, gosterge ve histogram degerleri etiketleriyle okunur', async () => {
    const requests = counter({ name: 'deneme_istek_total', help: 'h', labelNames: ['code'] });
    const lag = gauge({ name: 'deneme_gecikme_seconds', help: 'h' });
    const duration = histogram({ name: 'deneme_sure_seconds', help: 'h', labelNames: ['code'] });

    requests.inc({ code: 'OK' });
    requests.inc({ code: 'OK' });
    requests.inc({ code: 'INTERNAL' });
    lag.set(2.5);
    duration.observe({ code: 'OK' }, 0.02);

    expect(await metricValue('deneme_istek_total', { code: 'OK' })).toBe(2);
    expect(await metricValue('deneme_istek_total')).toBe(3);
    expect(await metricValue('deneme_gecikme_seconds')).toBe(2.5);
    expect(await histogramCount('deneme_sure_seconds', { code: 'OK' })).toBe(1);
    expect(await metricValue('deneme_yok_total')).toBeUndefined();
  });

  it('histogram varsayilan kovalari 5 ms - 10 sn', async () => {
    histogram({ name: 'deneme_kova_seconds', help: 'h' }).observe(0.003);

    const bounds = (await metricSamples('deneme_kova_seconds'))
      .filter((sample) => sample.name === 'deneme_kova_seconds_bucket')
      .map((sample) => sample.labels['le']);

    expect(bounds).toEqual([...DURATION_BUCKETS_SECONDS, '+Inf']);
    expect(DURATION_BUCKETS_SECONDS[0]).toBe(0.005);
    expect(DURATION_BUCKETS_SECONDS.at(-1)).toBe(10);
  });
});

describe('defter', () => {
  it('setServiceLabel her metrige `service` etiketi ekler (once tanimlanana da)', async () => {
    counter({ name: 'deneme_servis_total', help: 'h' }).inc();
    setServiceLabel('catalog');

    const text = await metricsRegistry.metrics();

    expect(text).toContain('deneme_servis_total{service="catalog"} 1');
  });

  it('surec metrikleri bir kez acilir; ikinci cagri hata vermez', async () => {
    enableProcessMetrics();
    enableProcessMetrics();

    const text = await metricsRegistry.metrics();

    expect(text).toMatch(/^process_cpu_user_seconds_total\{/m);
    expect(text).toMatch(/^nodejs_eventloop_lag_seconds\{/m);
    expect(text.match(/^# TYPE process_cpu_user_seconds_total /gm)).toHaveLength(1);
  });
});
