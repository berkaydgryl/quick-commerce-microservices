/**
 * Tick isci (T13.3): liderse turu isletir, degilse beklemez; tur hatasi isciyi
 * durdurmaz; tur sure butcelidir ve kapanista kesilir; kapanista suren tur
 * beklenir ve kilit birakilir. Sahte saat.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdvanceRoutes, AdvanceSummary } from '../../src/application/advance-routes.js';
import type { LeaderLock } from '../../src/domain/leader-lock.js';
import { startRouteTicker } from '../../src/interfaces/workers/route-ticker.js';

const INTERVAL_MS = 2_000;
const BUDGET_MS = 5_000;
const QUIET: AdvanceSummary = {
  moving: 2,
  picked_up: 0,
  delivered: 0,
  ended: 0,
  stale: 0,
  failed: 0,
  deferred: 0,
  reconciled: 0,
};

class FakeLock implements LeaderLock {
  holding = true;
  released = 0;
  hold(): Promise<boolean> {
    return Promise.resolve(this.holding);
  }
  release(): Promise<void> {
    this.released += 1;
    return Promise.resolve();
  }
}

let lines: LogLine[];
let lock: FakeLock;

beforeEach(() => {
  vi.useFakeTimers();
  lines = [];
  lock = new FakeLock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startRouteTicker', () => {
  it('liderken her aralikta tur isler; lider degilken turu atlar', async () => {
    const advance = vi.fn<AdvanceRoutes>(() => Promise.resolve(QUIET));
    const ticker = startRouteTicker({
      lock,
      advance,
      intervalMs: INTERVAL_MS,
      budgetMs: BUDGET_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(advance).toHaveBeenCalledTimes(2);

    lock.holding = false;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(advance).toHaveBeenCalledTimes(2);
    expect(lines.map((line) => line.message)).toEqual(
      expect.arrayContaining(['tick lider oldu', 'tick liderligi kaybetti']),
    );

    await ticker.stop();
  });

  it('tur ozeti yalnizca kilometre tasinda yazilir', async () => {
    const advance = vi
      .fn<AdvanceRoutes>()
      .mockResolvedValueOnce(QUIET)
      .mockResolvedValueOnce({ ...QUIET, delivered: 1 });
    const ticker = startRouteTicker({
      lock,
      advance,
      intervalMs: INTERVAL_MS,
      budgetMs: BUDGET_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(lines.filter((line) => line.message === 'rotalar ilerletildi')).toHaveLength(1);
    await ticker.stop();
  });

  it('tur hatasi isciyi durdurmaz: sonraki aralikta yeniden dener', async () => {
    const advance = vi
      .fn<AdvanceRoutes>()
      .mockRejectedValueOnce(new Error('mongo yok'))
      .mockResolvedValue(QUIET);
    const ticker = startRouteTicker({
      lock,
      advance,
      intervalMs: INTERVAL_MS,
      budgetMs: BUDGET_MS,
      logger: recordingLogger(lines),
    });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(advance).toHaveBeenCalledTimes(2);
    expect(lines.some((line) => line.message === 'tick turu basarisiz; aralik sonra tekrar')).toBe(
      true,
    );
    await ticker.stop();
  });

  it('kapanis: suren tur beklenir, yeni tur planlanmaz, lider kilidi birakir', async () => {
    let finish: () => void = () => undefined;
    const advance = vi.fn<AdvanceRoutes>(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(QUIET);
        }),
    );
    const ticker = startRouteTicker({
      lock,
      advance,
      intervalMs: INTERVAL_MS,
      budgetMs: BUDGET_MS,
      logger: recordingLogger(lines),
    });
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    const stopping = ticker.stop();
    finish();
    await stopping;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(advance).toHaveBeenCalledTimes(1);
    expect(lock.released).toBe(1);
  });

  it('tur butcesi: devam sorusu butce dolunca ve kapanista false; ertelenen rota WARN', async () => {
    let shouldContinue: () => boolean = () => true;
    let finish: () => void = () => undefined;
    const advance = vi.fn<AdvanceRoutes>(
      (_logger, keepGoing) =>
        new Promise((resolve) => {
          shouldContinue = keepGoing ?? (() => true);
          finish = () => resolve({ ...QUIET, deferred: 3 });
        }),
    );
    const ticker = startRouteTicker({
      lock,
      advance,
      intervalMs: INTERVAL_MS,
      budgetMs: BUDGET_MS,
      logger: recordingLogger(lines),
    });
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(shouldContinue()).toBe(true);
    await vi.advanceTimersByTimeAsync(BUDGET_MS);
    expect(shouldContinue()).toBe(false);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(lines.find((line) => line.level === 'warn')?.message).toBe(
      'tur butcesi doldu; kalan rotalar sonraki turda',
    );

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(shouldContinue()).toBe(true);
    const stopping = ticker.stop();
    expect(shouldContinue()).toBe(false);
    finish();
    await stopping;
  });
});
