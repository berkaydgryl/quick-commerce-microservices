/**
 * Outbox yayinci isci (T7.3): zamanlama ve kapanis. Sahte zamanlayicilar;
 * tur (relay) sahte.
 */

import { silentLogger } from '@getir/core';
import type { LogFields } from '@getir/core';
import { metricsRegistry } from '@getir/observability';
import { metricValue } from '@getir/observability/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RelayOutbox, RelayRound } from '../../src/application/relay-outbox.js';
import { OUTBOX_METRICS } from '../../src/interfaces/workers/outbox-metrics.js';
import { startOutboxPublisher } from '../../src/interfaces/workers/outbox-publisher.js';

const INTERVAL_MS = 500;
const BATCH = 100;

/** Basarili tur: `published` olay yayinlandi, kuyruk gecikmesi yok. */
const round = (published: number, extra: Partial<RelayRound> = {}): RelayRound => ({
  published,
  failed: false,
  lagMs: 0,
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  metricsRegistry.resetMetrics();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startOutboxPublisher', () => {
  it('aralikla tur calistirir; tur bitmeden yenisi baslamaz', async () => {
    const relay = vi.fn(() => Promise.resolve(round(0)));
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger: silentLogger,
    });

    expect(relay).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(relay).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(relay).toHaveBeenCalledTimes(2);

    await worker.stop();
  });

  it('uzun suren tur bitmeden YENISI BASLAMAZ; sonraki tur bittikten bir aralik sonra', async () => {
    let finish: (result: RelayRound) => void = () => undefined;
    const relay = vi
      .fn<RelayOutbox>()
      .mockImplementationOnce(() => new Promise<RelayRound>((resolve) => (finish = resolve)))
      .mockResolvedValue(round(0));
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger: silentLogger,
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    // Ilk tur hala suruyor: setInterval olsaydi ucu daha baslamisti.
    expect(relay).toHaveBeenCalledTimes(1);

    finish(round(0));
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(relay).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay).toHaveBeenCalledTimes(2);

    await worker.stop();
  });

  it('tam dolu parti cikarsa beklemeden devam eder (kuyruk erir)', async () => {
    const relay = vi
      .fn<RelayOutbox>()
      .mockResolvedValueOnce(round(BATCH))
      .mockResolvedValueOnce(round(BATCH))
      .mockResolvedValue(round(0));
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger: silentLogger,
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    // Dolu partiden sonra 0 ms'lik bekleme: saat 1 ms ilerleyince sonraki tur.
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay).toHaveBeenCalledTimes(3);

    // Ucuncu tur bos: artik aralik kadar beklenir.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 10);
    expect(relay).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10);
    expect(relay).toHaveBeenCalledTimes(4);

    await worker.stop();
  });

  it('tur hata verirse isci durmaz, hata gunluge yazilir', async () => {
    const error = vi.fn<(fields: LogFields, message: string) => void>();
    const logger = { ...silentLogger, error, child: () => logger };
    const relay = vi
      .fn<RelayOutbox>()
      .mockRejectedValueOnce(new Error('mongo kapali'))
      .mockResolvedValue(round(0));
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger,
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(relay).toHaveBeenCalledTimes(2);
    const [fields] = error.mock.calls[0] ?? [];
    expect(fields).toMatchObject({ err: new Error('mongo kapali') });
    await worker.stop();
  });

  it('stop suren turu BEKLER ve yeni tur planlamaz', async () => {
    let finish: (result: RelayRound) => void = () => undefined;
    const relay = vi.fn(() => new Promise<RelayRound>((resolve) => (finish = resolve)));
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger: silentLogger,
    });
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finish(round(0));
    await stopping;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(stopped).toBe(true);
    expect(relay).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('startOutboxPublisher: metrikler (T10.5, #12)', () => {
  it('yayinlanani sayar, gecikmeyi saniye olarak yazar; yarida kalan tur hata sayilir', async () => {
    const relay = vi
      .fn<RelayOutbox>()
      .mockResolvedValueOnce(round(3, { lagMs: 1_200 }))
      .mockResolvedValueOnce(round(1, { failed: true, lagMs: 4_000 }))
      .mockResolvedValue(round(0));
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger: silentLogger,
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(await metricValue(OUTBOX_METRICS.PUBLISHED)).toBe(4);
    expect(await metricValue(OUTBOX_METRICS.ERRORS)).toBe(1);
    expect(await metricValue(OUTBOX_METRICS.LAG)).toBe(4);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    // Kuyruk eridi: gecikme sifira iner.
    expect(await metricValue(OUTBOX_METRICS.LAG)).toBe(0);
    await worker.stop();
  });

  it('hic yapilamayan tur hata sayilir; gecikme son degerinde kalir', async () => {
    const relay = vi
      .fn<RelayOutbox>()
      .mockResolvedValueOnce(round(0, { lagMs: 2_000 }))
      .mockRejectedValueOnce(new Error('mongo kapali'))
      .mockResolvedValue(round(0));
    const worker = startOutboxPublisher({
      relay,
      intervalMs: INTERVAL_MS,
      batchSize: BATCH,
      logger: silentLogger,
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(await metricValue(OUTBOX_METRICS.ERRORS)).toBe(1);
    expect(await metricValue(OUTBOX_METRICS.LAG)).toBe(2);
    await worker.stop();
  });
});
