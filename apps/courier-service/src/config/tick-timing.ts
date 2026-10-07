/**
 * Tick'in sureleri (T13.3) tek yerden, tick araligindan turetilir: kilit omru,
 * turun sure butcesi ve canli konumun omru. Ayri ayri sabitlenirse biri
 * digerinden kisa kalabilir (or. tick 60 sn iken 30 sn'lik konum omru).
 */

import {
  COURIER_LIVE_LOCATION_TTL_MS,
  COURIER_LIVE_LOCATION_TTL_TICKS,
  COURIER_TICK_BUDGET_DIVISOR,
  COURIER_TICK_LOCK_MIN_TTL_MS,
  COURIER_TICK_LOCK_TTL_MULTIPLIER,
} from './constants.js';

export interface TickTiming {
  readonly intervalMs: number;
  /** Lider kilidinin omru: max(aralik x 5, 10 sn). */
  readonly lockTtlMs: number;
  /** Turun sure butcesi: kilit omrunun yarisi (tur kilit dusmeden biter). */
  readonly budgetMs: number;
  /** Canli konumun omru: max(30 sn, aralik x 3). */
  readonly liveTtlMs: number;
}

export function tickTiming(intervalMs: number): TickTiming {
  const lockTtlMs = Math.max(
    intervalMs * COURIER_TICK_LOCK_TTL_MULTIPLIER,
    COURIER_TICK_LOCK_MIN_TTL_MS,
  );
  return {
    intervalMs,
    lockTtlMs,
    budgetMs: Math.floor(lockTtlMs / COURIER_TICK_BUDGET_DIVISOR),
    liveTtlMs: Math.max(COURIER_LIVE_LOCATION_TTL_MS, intervalMs * COURIER_LIVE_LOCATION_TTL_TICKS),
  };
}
