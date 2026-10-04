/**
 * Kurye atayan isci (T13.1 PR 2): zamanlama, kapanis, metrik ve gunluk.
 * Sahte zamanlayicilar; tur (dispatch) sahte. T13.2: ulasilamama kaynak
 * basina (D1), tur ozeti yalnizca atama, geri verme ya da hatada (D2).
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { metricsRegistry } from '@getir/observability';
import { metricValue } from '@getir/observability/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DISPATCH_SOURCE } from '../../src/application/assign-courier-step.js';
import type { DispatchSource } from '../../src/application/assign-courier-step.js';
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
  failedBy: { courier: 0, store: 0, order: 0 },
  backedOff: 0,
  deferred: 0,
  ...extra,
});

/** `count` siparis `source` yuzunden atanamadi. */
const failedFrom = (source: DispatchSource, count: number): Partial<DispatchRound> => ({
  failed: count,
  failedBy: { courier: 0, store: 0, order: 0, [source]: count },
});

/** Tur `source`'a ulasilamadigi icin kesildi (ya da kuyruk okunamadi). */
const cutBy = (source: DispatchSource, deferred: number): Partial<DispatchRound> => ({
  deferred,
  unavailable: source,
  cause: new Error(`${source} yok`),
});

const COURIER_DOWN =
  'kurye servisine ulasilamiyor; siparisler bekliyor, her turda yeniden denenecek';
const STORE_DOWN =
  'siparis deposuna ulasilamiyor; kurye atamasi bekliyor, her turda yeniden denenecek';
const SUMMARY = 'kurye atama turu tamamlandi';

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
      .mockResolvedValueOnce(
        round({
          assigned: 2,
          noCourier: 1,
          released: 1,
          ...failedFrom(DISPATCH_SOURCE.COURIER, 1),
        }),
      )
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
    expect(await metricValue(ORDER_DISPATCHER_METRICS.ERRORS, { source: 'courier' })).toBe(1);
    // Ozet yalnizca bir sey olan turda (bos tur gunlugu doldurmaz).
    const summaries = lines.filter((line) => line.message === 'kurye atama turu tamamlandi');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ level: 'info', fields: { assigned: 2, released: 1 } });

    await worker.stop();
  });

  it('courier ulasilamazken her saniye satir YOK: gecis bir kez WARN, geri gelis bir kez INFO; turlar hata sayilir', async () => {
    const dispatch = vi
      .fn<DispatchCouriers>()
      .mockResolvedValueOnce(round(cutBy(DISPATCH_SOURCE.COURIER, 3)))
      .mockResolvedValueOnce(round(cutBy(DISPATCH_SOURCE.COURIER, 3)))
      .mockResolvedValueOnce(round(cutBy(DISPATCH_SOURCE.COURIER, 3)))
      .mockResolvedValueOnce(round({ assigned: 3 }))
      .mockResolvedValue(round());
    const worker = startCourierDispatcher({
      dispatch,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(5 * INTERVAL_MS);

    expect(messages('warn')).toEqual([COURIER_DOWN]);
    expect(
      messages('info').filter((message) => message === 'kurye servisine yeniden ulasildi'),
    ).toHaveLength(1);
    expect(await metricValue(ORDER_DISPATCHER_METRICS.ERRORS, { source: 'courier' })).toBe(3);
    expect(await metricValue(ORDER_DISPATCHER_METRICS.ERRORS, { source: 'store' })).toBeUndefined();
    // Yalnizca ertelenen tur ozet satiri yazmaz.
    expect(lines.filter((line) => line.message === SUMMARY)).toHaveLength(1);

    await worker.stop();
  });

  it('D1: depo (kuyruk okunamadi) courier sanilmaz: depoya gecis bir WARN, donus bir INFO; metrik etiketi store', async () => {
    const dispatch = vi
      .fn<DispatchCouriers>()
      .mockResolvedValueOnce(round(cutBy(DISPATCH_SOURCE.STORE, 0)))
      .mockResolvedValueOnce(round(cutBy(DISPATCH_SOURCE.STORE, 0)))
      .mockResolvedValueOnce(round(cutBy(DISPATCH_SOURCE.STORE, 0)))
      .mockResolvedValue(round());
    const worker = startCourierDispatcher({
      dispatch,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(5 * INTERVAL_MS);

    expect(messages('warn')).toEqual([STORE_DOWN]);
    expect(lines.find((line) => line.message === STORE_DOWN)?.fields).toMatchObject({
      source: 'store',
      err: expect.any(Error) as unknown,
    });
    expect(messages('info')).toEqual([
      'kurye atayan isci basladi',
      'siparis deposuna yeniden ulasildi',
    ]);
    expect(messages('error')).toEqual([]);
    expect(await metricValue(ORDER_DISPATCHER_METRICS.ERRORS, { source: 'store' })).toBe(3);
    expect(
      await metricValue(ORDER_DISPATCHER_METRICS.ERRORS, { source: 'courier' }),
    ).toBeUndefined();

    await worker.stop();
  });

  it('D1: courier icin "geri geldi" ancak courier cevap verince; depo arizasi courier i iyilestirmez', async () => {
    const dispatch = vi
      .fn<DispatchCouriers>()
      .mockResolvedValueOnce(round(cutBy(DISPATCH_SOURCE.COURIER, 2)))
      .mockResolvedValueOnce(round(cutBy(DISPATCH_SOURCE.STORE, 0)))
      .mockResolvedValueOnce(round()) // talep yok: courier'e sorulmadi
      .mockResolvedValueOnce(round({ noCourier: 1 }))
      .mockResolvedValue(round());
    const worker = startCourierDispatcher({
      dispatch,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS);
    expect(messages('warn')).toEqual([COURIER_DOWN, STORE_DOWN]);
    expect(messages('info')).toEqual([
      'kurye atayan isci basladi',
      'siparis deposuna yeniden ulasildi',
    ]);

    await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);
    expect(messages('info')).toEqual([
      'kurye atayan isci basladi',
      'siparis deposuna yeniden ulasildi',
      'kurye servisine yeniden ulasildi',
    ]);

    await worker.stop();
  });

  it('D2: bekleyen yine "kurye yok" aldiysa ya da yazim yaristiysa ozet YOK; atama, geri verme ya da hatada var', async () => {
    const dispatch = vi
      .fn<DispatchCouriers>()
      .mockResolvedValueOnce(round({ noCourier: 40 }))
      .mockResolvedValueOnce(round({ skipped: 2, backedOff: 3 }))
      .mockResolvedValueOnce(round({ released: 1 }))
      .mockResolvedValueOnce(round(failedFrom(DISPATCH_SOURCE.STORE, 1)))
      .mockResolvedValue(round());
    const worker = startCourierDispatcher({
      dispatch,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(5 * INTERVAL_MS);

    const summaries = lines.filter((line) => line.message === SUMMARY);
    expect(summaries.map((line) => line.fields)).toEqual([
      expect.objectContaining({ released: 1 }),
      expect.objectContaining({ failed: 1 }),
    ]);
    expect(await metricValue(ORDER_DISPATCHER_METRICS.DISPATCHED, { outcome: 'no_courier' })).toBe(
      40,
    );
    expect(await metricValue(ORDER_DISPATCHER_METRICS.ERRORS, { source: 'store' })).toBe(1);

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
