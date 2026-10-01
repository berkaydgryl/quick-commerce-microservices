/**
 * Surum cakismasinda sinirli yeniden deneme (roadmap P3). Bekleme ve
 * rastgelelik sahte: testler zamana bagli degil.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it, vi } from 'vitest';

import { CONFLICT_RETRY_DELAYS_MS, retryOnConflict } from '../../src/retry.js';

const conflict = () => AppError.conflict('Kayit ayni anda baska bir islemle degisti');

/** Verilen sayida CONFLICT, sonra basari. */
function flaky(conflicts: number, result = 'tamam') {
  let calls = 0;
  const work = vi.fn(() => {
    calls += 1;
    return calls <= conflicts ? Promise.reject(conflict()) : Promise.resolve(result);
  });
  return work;
}

function options(random = () => 0.5) {
  const waits: number[] = [];
  return {
    waits,
    sleep: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
    random,
  };
}

describe('retryOnConflict (P3)', () => {
  it('P3 beklemeleri 50, 100, 200 ms (en cok 3 yeniden deneme)', () => {
    expect(CONFLICT_RETRY_DELAYS_MS).toEqual([50, 100, 200]);
  });

  it('iki cakismadan sonra basarir; beklemeler sirayla 50 ve 100 ms (jitter ortada)', async () => {
    const work = flaky(2);
    const { waits, ...rest } = options();

    expect(await retryOnConflict(work, rest)).toBe('tamam');
    expect(work).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([50, 100]);
  });

  it('uc yeniden denemede de cakisirsa SON CONFLICT firlatilir (toplam 4 deneme)', async () => {
    const work = flaky(10);
    const { waits, ...rest } = options();

    await expect(retryOnConflict(work, rest)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(work).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([50, 100, 200]);
  });

  it('jitter beklemeyi %50 asagi ve yukari oynatir', async () => {
    const low = options(() => 0);
    const high = options(() => 0.999);

    await retryOnConflict(flaky(1), low);
    await retryOnConflict(flaky(1), high);

    expect(low.waits).toEqual([25]);
    expect(high.waits).toEqual([75]);
  });

  it('CONFLICT disindaki hata hemen gecer, yeniden denenmez', async () => {
    const work = vi.fn(() =>
      Promise.reject(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'mongo kapali')),
    );
    const { waits, ...rest } = options();

    await expect(retryOnConflict(work, rest)).rejects.toMatchObject({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
    expect(work).toHaveBeenCalledOnce();
    expect(waits).toEqual([]);
  });

  it('her yeniden denemede onRetry: kacinci deneme ve bekleme', async () => {
    const seen: [number, number][] = [];

    await retryOnConflict(flaky(2), {
      ...options(),
      onRetry: (retry, delayMs) => seen.push([retry, delayMs]),
    });

    expect(seen).toEqual([
      [1, 50],
      [2, 100],
    ]);
  });
});
