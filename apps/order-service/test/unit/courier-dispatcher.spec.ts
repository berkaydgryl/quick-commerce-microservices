/**
 * Kurye atayan isci (T13.1 PR 2): zamanlama, kapanis, metrik ve gunluk.
 * Sahte zamanlayicilar; tur (dispatch) sahte.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { metricsRegistry } from '@getir/observability';
import { metricValue } from '@getir/observability/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DispatchCouriers, DispatchRound } from '../../src/application/dispatch-couriers.js';
import { startCourierDispatcher } from '../../src/interfaces/workers/courier-dispatcher.js';
import { ORDER_DISPATCHER_METRICS } from '../../src/interfaces/workers/dispatcher-metrics.js';

const INTERVAL_MS = 1_000;

const round = (extra: Partial<DispatchRound> = {}): DispatchRound => ({
  assigned: 0,
  noCourier: 0,
  released: 0,
  skipped: 0,
  failed: 0,
  deferred: 0,
  ...extra,
});

let lines: LogLine[];

beforeEach(() => {
  vi.useFakeTimers();
  metricsRegistry.resetMetrics();
  lines = [];
});

afterEach(() => {
  vi.useRealTimers();
});

const messages = (level: string) =>
  lines.filter((line) => line.level === level).map((line) => line.message);

describe('startCourierDispatcher', () => {
  it('aralikla tur calistirir; uzun tur bitmeden yenisi BASLAMAZ', async () => {
    let finish: (result: DispatchRound) => void = () => undefined;
    const dispatch = vi
      .fn<DispatchCouriers>()
      .mockImplementationOnce(() => new Promise<DispatchRound>((resolve) => (finish = resolve)))
      .mockResolvedValue(round());
    const worker = startCourierDispatcher({
      dispatch,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    expect(dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * INTERVAL_MS);
    expect(dispatch).toHaveBeenCalledTimes(1);

    finish(round());
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(dispatch).toHaveBeenCalledTimes(2);

    await worker.stop();
  });

  it('sonuclari etiketle sayar, atanamayanlar hata; bir sey olduysa ozet satiri', async () => {
    const dispatch = vi
      .fn<DispatchCouriers>()
      .mockResolvedValueOnce(round({ assigned: 2, noCourier: 1, released: 1, failed: 1 }))
      .mockResolvedValue(round());
    const worker = startCourierDispatcher({
      dispatch,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS);

    const dispatched = ORDER_DISPATCHER_METRICS.DISPATCHED;
    expect(await metricValue(dispatched, { outcome: 'assigned' })).toBe(2);
    expect(await metricValue(dispatched, { outcome: 'no_courier' })).toBe(1);
    expect(await metricValue(dispatched, { outcome: 'released' })).toBe(1);
    expect(await metricValue(ORDER_DISPATCHER_METRICS.ERRORS)).toBe(1);
    // Ozet yalnizca bir sey olan turda (bos tur gunlugu doldurmaz).
    const summaries = lines.filter((line) => line.message === 'kurye atama turu tamamlandi');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ level: 'info', fields: { assigned: 2, released: 1 } });

    await worker.stop();
  });

  it('courier ulasilamazken her saniye satir YOK: gecis bir kez WARN, geri gelis bir kez INFO; turlar hata sayilir', async () => {
    const dispatch = vi
      .fn<DispatchCouriers>()
      .mockResolvedValueOnce(round({ deferred: 3 }))
      .mockResolvedValueOnce(round({ deferred: 3 }))
      .mockResolvedValueOnce(round({ deferred: 3 }))
      .mockResolvedValueOnce(round({ assigned: 3 }))
      .mockResolvedValue(round());
    const worker = startCourierDispatcher({
      dispatch,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(5 * INTERVAL_MS);

    expect(messages('warn')).toEqual([
      'kurye servisine ulasilamiyor; siparisler bekliyor, her turda yeniden denenecek',
    ]);
    expect(messages('info')).toContain('kurye servisine yeniden ulasildi');
    expect(await metricValue(ORDER_DISPATCHER_METRICS.ERRORS)).toBe(3);
    // Yalnizca ertelenen tur ozet satiri yazmaz.
    expect(lines.filter((line) => line.message === 'kurye atama turu tamamlandi')).toHaveLength(1);

    await worker.stop();
  });

  it('tur duserse isci durmaz: hata sayilir, ERROR satiri, aralik sonra tekrar', async () => {
    const dispatch = vi
      .fn<DispatchCouriers>()
      .mockRejectedValueOnce(new Error('mongo okunamadi'))
      .mockResolvedValue(round());
    const worker = startCourierDispatcher({
      dispatch,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(await metricValue(ORDER_DISPATCHER_METRICS.ERRORS)).toBe(1);
    expect(messages('error')).toEqual(['kurye atama turu basarisiz; aralik sonra tekrar']);

    await worker.stop();
  });

  it('stop suren turu BEKLER ve yeni tur planlamaz', async () => {
    let finish: (result: DispatchRound) => void = () => undefined;
    const dispatch = vi
      .fn<DispatchCouriers>()
      .mockImplementation(() => new Promise<DispatchRound>((resolve) => (finish = resolve)));
    const worker = startCourierDispatcher({
      dispatch,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    let stopped = false;
    const stopping = worker.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finish(round());
    await stopping;
    await vi.advanceTimersByTimeAsync(5 * INTERVAL_MS);
    expect(stopped).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
