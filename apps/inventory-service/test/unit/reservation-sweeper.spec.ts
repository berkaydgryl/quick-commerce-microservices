/**
 * Supurucu isci (T10.3, B25): liderlik ve tur dongusu. Kilit ve tur sahte,
 * zamanlayici gercek ve kisa. Gercek Redis ile devralma
 * test/integration/reservation.spec.ts'te.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { SweepResult } from '../../src/application/sweep-expired.js';
import { startReservationSweeper } from '../../src/interfaces/workers/reservation-sweeper.js';

const QUIET: SweepResult = { expired: 0, completed: 0, pending: 0 };
const INTERVAL_MS = 5;

function harness(
  leaderTurns: readonly boolean[],
  sweep: () => Promise<SweepResult> = () => Promise.resolve(QUIET),
) {
  let turn = 0;
  const lines: LogLine[] = [];
  const lock = {
    hold: vi.fn(() =>
      Promise.resolve(leaderTurns[Math.min(turn++, leaderTurns.length - 1)] ?? false),
    ),
    release: vi.fn(() => Promise.resolve()),
  };
  const sweepSpy = vi.fn(sweep);
  const worker = startReservationSweeper({
    lock,
    sweep: sweepSpy,
    intervalMs: INTERVAL_MS,
    logger: recordingLogger(lines),
  });
  const messages = () => lines.map((line) => line.message);
  return { worker, lock, sweep: sweepSpy, messages };
}

describe('startReservationSweeper', () => {
  it('lider olan her turda supurur; liderlik bir kez gunluge yazilir; kapanista kilidi birakir', async () => {
    const { worker, lock, sweep, messages } = harness([true]);

    await vi.waitFor(() => expect(sweep.mock.calls.length).toBeGreaterThanOrEqual(3));
    await worker.stop();

    expect(messages().filter((message) => message === 'supurucu lider oldu')).toHaveLength(1);
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it('lider olmayan supurmez; kapanista kilide dokunmaz', async () => {
    const { worker, lock, sweep } = harness([false]);

    await vi.waitFor(() => expect(lock.hold.mock.calls.length).toBeGreaterThanOrEqual(3));
    await worker.stop();

    expect(sweep).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('liderlik kaybedilince supurme durur ve bir uyari yazilir', async () => {
    const { worker, sweep, messages } = harness([true, true, false]);

    await vi.waitFor(() => expect(messages()).toContain('supurucu liderligi kaybetti'));
    const sweptBefore = sweep.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 5));
    await worker.stop();

    expect(sweptBefore).toBe(2);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('tur duserse hata yazilir, isci durmaz; geri verilen olan tur ozetlenir', async () => {
    let calls = 0;
    const { worker, messages } = harness([true], () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('redis kapali'))
        : Promise.resolve({ expired: 2, completed: 0, pending: 0 });
    });

    await vi.waitFor(() =>
      expect(messages()).toContain('suresi dolan rezervasyonlar geri verildi'),
    );
    await worker.stop();

    expect(messages()).toContain('supurucu turu basarisiz; aralik sonra tekrar');
  });

  it('kapanis suren turu bekler: tur bitmeden stop donmez', async () => {
    let finish: () => void = () => undefined;
    const { worker, lock } = harness(
      [true],
      () =>
        new Promise((resolve) => {
          finish = () => resolve(QUIET);
        }),
    );
    await vi.waitFor(() => expect(lock.hold).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));

    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 3));
    expect(stopped).toBe(false);

    finish();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('kapanista kilit birakilamazsa uyari yazilir, kapanis yine tamamlanir (kilit omru dolunca duser)', async () => {
    const { worker, lock, sweep, messages } = harness([true]);
    lock.release.mockRejectedValueOnce(new Error('redis kapali'));
    await vi.waitFor(() => expect(sweep).toHaveBeenCalled());

    await expect(worker.stop()).resolves.toBeUndefined();
    expect(messages()).toContain('supurucu kilidi birakilamadi; omru dolunca duser');
  });
});
