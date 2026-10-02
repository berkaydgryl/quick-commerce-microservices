/**
 * Siparis supurucusu isci (T11.2 PR 2): zamanlama, kapanis, metrik ve ozet
 * satiri. Sahte zamanlayicilar; tur (sweep) sahte.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { metricsRegistry } from '@getir/observability';
import { metricValue } from '@getir/observability/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SweepExpiredReservations,
  SweepRound,
} from '../../src/application/sweep-expired-reservations.js';
import { startReservationSweeper } from '../../src/interfaces/workers/reservation-sweeper.js';
import { ORDER_SWEEPER_METRICS } from '../../src/interfaces/workers/sweeper-metrics.js';

const INTERVAL_MS = 10_000;

const round = (extra: Partial<SweepRound> = {}): SweepRound => ({
  closedDrafts: 0,
  closedAwaitingPayment: 0,
  refunded: 0,
  waiting: 0,
  skipped: 0,
  failed: 0,
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

describe('startReservationSweeper', () => {
  it('aralikla tur calistirir; uzun tur bitmeden yenisi BASLAMAZ', async () => {
    let finish: (result: SweepRound) => void = () => undefined;
    const sweep = vi
      .fn<SweepExpiredReservations>()
      .mockImplementationOnce(() => new Promise<SweepRound>((resolve) => (finish = resolve)))
      .mockResolvedValue(round());
    const worker = startReservationSweeper({
      sweep,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS);
    expect(sweep).toHaveBeenCalledTimes(1);

    finish(round());
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(sweep).toHaveBeenCalledTimes(2);

    await worker.stop();
  });

  it('kapatilanlari duruma gore, kapatilamayanlari hata sayar; bir sey olduysa ozet satiri', async () => {
    const sweep = vi
      .fn<SweepExpiredReservations>()
      .mockResolvedValueOnce(
        round({ closedDrafts: 2, closedAwaitingPayment: 1, refunded: 1, failed: 1 }),
      )
      .mockResolvedValue(round());
    const worker = startReservationSweeper({
      sweep,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);

    expect(await metricValue(ORDER_SWEEPER_METRICS.CLOSED, { status: 'DRAFT' })).toBe(2);
    expect(await metricValue(ORDER_SWEEPER_METRICS.CLOSED, { status: 'AWAITING_PAYMENT' })).toBe(1);
    expect(await metricValue(ORDER_SWEEPER_METRICS.ERRORS)).toBe(1);
    // Ozet yalnizca bir sey olan turda (bos tur gunlugu doldurmaz).
    const summaries = lines.filter((line) => line.message === 'kilidi dolan siparisler supuruldu');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ level: 'info', fields: { closedDrafts: 2, refunded: 1 } });

    await worker.stop();
  });

  it('tur duserse isci durmaz: hata sayilir, ERROR satiri, aralik sonra tekrar', async () => {
    const sweep = vi
      .fn<SweepExpiredReservations>()
      .mockRejectedValueOnce(new Error('mongo okunamadi'))
      .mockResolvedValue(round());
    const worker = startReservationSweeper({
      sweep,
      intervalMs: INTERVAL_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);

    expect(sweep).toHaveBeenCalledTimes(2);
    expect(await metricValue(ORDER_SWEEPER_METRICS.ERRORS)).toBe(1);
    expect(lines.map((line) => [line.level, line.message])).toContainEqual([
      'error',
      'siparis supurucu turu basarisiz; aralik sonra tekrar',
    ]);

    await worker.stop();
  });

  it('stop suren turu BEKLER ve yeni tur planlamaz', async () => {
    let finish: (result: SweepRound) => void = () => undefined;
    const sweep = vi
      .fn<SweepExpiredReservations>()
      .mockImplementation(() => new Promise<SweepRound>((resolve) => (finish = resolve)));
    const worker = startReservationSweeper({
      sweep,
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
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
