/**
 * Surum cakismasinda SINIRLI yeniden deneme (roadmap P3; ilk kullanan T10.2,
 * stok onayi).
 *
 * Is CONFLICT (AppError) ile duserse jitter'li ustel beklemeyle (yaklasik 50,
 * 100, 200 ms, her biri +-%50) en cok uc kez daha denenir; hepsi duserse SON
 * CONFLICT oldugu gibi firlatilir. Yardimci karar vermez: CONFLICT disindaki
 * hata hemen gecer, denemeler bitince ne yapilacagi (telafi) cagiranin isidir.
 *
 * Is her denemede BASTAN calisir: guncel veriyi yeniden okumali ve yan
 * etkisiz olmalidir (transaction geri cagrisi gibi). Jitter, ayni anda
 * cakisan iki cagrinin ayni anda yeniden denemesini (ve yine cakismasini)
 * onler.
 */

import { AppError, ERROR_CODES } from '@getir/core';

/** Yeniden denemelerden ONCE beklenen sureler (ms); uzunlugu deneme sayisidir (P3). */
export const CONFLICT_RETRY_DELAYS_MS: readonly number[] = [50, 100, 200];

/** Beklemenin rastgele sapmasi: sure x [0.5, 1.5). */
const JITTER_RATIO = 0.5;

export interface ConflictRetryOptions {
  /** Yeniden denemelerden once beklenecek sureler (ms). Verilmezse P3'unkiler. */
  readonly delaysMs?: readonly number[];
  /** Her yeniden denemeden once cagrilir (gunluk icin): kacinci deneme, bekleme, hata. */
  readonly onRetry?: (retry: number, delayMs: number, error: AppError) => void;
  /** Test icin: bekleme ve rastgelelik. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function retryOnConflict<T>(
  work: () => Promise<T>,
  options: ConflictRetryOptions = {},
): Promise<T> {
  const delays = options.delaysMs ?? CONFLICT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? wait;
  const random = options.random ?? Math.random;

  for (let retry = 0; ; retry += 1) {
    try {
      return await work();
    } catch (error: unknown) {
      const delay = delays[retry];
      if (!isConflict(error) || delay === undefined) {
        throw error;
      }
      const jittered = Math.round(delay * (1 - JITTER_RATIO + random() * 2 * JITTER_RATIO));
      options.onRetry?.(retry + 1, jittered, error);
      await sleep(jittered);
    }
  }
}

function isConflict(error: unknown): error is AppError {
  return error instanceof AppError && error.code === ERROR_CODES.CONFLICT;
}
