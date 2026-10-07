/**
 * Arka planda suren kayitlar (#167): sonuc BIR KEZ bildirilir (late ya da
 * lost); kapanista sinirli beklenir, bitmeyen birakilir; kapanistan sonra
 * gelen kayit hemen birakilir; bildirim firlatsa da unhandledRejection yok.
 * Sahte saat (belirlenimci).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ABANDONED_REASON, PendingRecords } from '../../src/application/pending-records.js';

let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  vi.useFakeTimers();
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.useRealTimers();
});

/** Disaridan bitirilen kayit. */
function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function handlers() {
  return { onLate: vi.fn(), onLost: vi.fn() };
}

describe('PendingRecords', () => {
  it('bos: drain hemen 0 doner', async () => {
    expect(await new PendingRecords().drain(10_000)).toBe(0);
  });

  it('biten kayit late, dusen kayit lost: BIR KEZ; izlemeden cikar; reddi yakalanir', async () => {
    const pending = new PendingRecords();
    const ok = deferred();
    const bad = deferred();
    const okWatch = handlers();
    const badWatch = handlers();
    pending.watch(ok.promise, okWatch);
    pending.watch(bad.promise, badWatch);
    expect(pending.size).toBe(2);

    ok.resolve();
    bad.reject(new Error('mongo yok'));
    await vi.advanceTimersByTimeAsync(0);

    expect(okWatch.onLate).toHaveBeenCalledTimes(1);
    expect(okWatch.onLost).not.toHaveBeenCalled();
    expect(badWatch.onLost).toHaveBeenCalledWith(new Error('mongo yok'));
    expect(badWatch.onLate).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
    expect(unhandled).toEqual([]);
  });

  it('drain bitmesini bekler: sure icinde biten kayit birakilmaz (late)', async () => {
    const pending = new PendingRecords();
    const record = deferred();
    const watch = handlers();
    pending.watch(record.promise, watch);
    setTimeout(record.resolve, 500);

    const drained = pending.drain(1_000);
    await vi.advanceTimersByTimeAsync(500);

    expect(await drained).toBe(0);
    expect(watch.onLate).toHaveBeenCalledTimes(1);
    expect(watch.onLost).not.toHaveBeenCalled();
  });

  it('sure dolunca bitmeyen kayit BIR KEZ birakilir (lost); sonra gelen sonuc yok sayilir', async () => {
    const pending = new PendingRecords();
    const record = deferred();
    const watch = handlers();
    pending.watch(record.promise, watch);

    const drained = pending.drain(30);
    await vi.advanceTimersByTimeAsync(29);
    expect(watch.onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await drained).toBe(1);
    expect(watch.onLost).toHaveBeenCalledTimes(1);
    expect(watch.onLost).toHaveBeenCalledWith(new Error(ABANDONED_REASON));
    record.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.onLate).not.toHaveBeenCalled();
    expect(watch.onLost).toHaveBeenCalledTimes(1);
  });

  it('kapanistan SONRA izlemeye giren kayit hemen birakilir (Mongo kapaniyor)', async () => {
    const pending = new PendingRecords();
    expect(await pending.drain(10)).toBe(0);
    const watch = handlers();

    pending.watch(deferred().promise, watch);

    expect(watch.onLost).toHaveBeenCalledWith(new Error(ABANDONED_REASON));
    expect(pending.size).toBe(0);
  });

  it('bildirim firlatsa da: diger kayitlar yine birakilir, unhandledRejection yok', async () => {
    const pending = new PendingRecords();
    const throwing = {
      onLate: vi.fn(),
      onLost: vi.fn(() => {
        throw new Error('gunluk bozuk');
      }),
    };
    const second = handlers();
    const failing = deferred();
    pending.watch(failing.promise, throwing);
    pending.watch(deferred().promise, throwing);
    pending.watch(deferred().promise, second);

    failing.reject(new Error('mongo yok'));
    await vi.advanceTimersByTimeAsync(0);
    const drained = pending.drain(10);
    await vi.advanceTimersByTimeAsync(10);

    expect(await drained).toBe(2);
    expect(throwing.onLost).toHaveBeenCalledTimes(2);
    expect(second.onLost).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
  });
});
