/**
 * Tick sureleri (T13.3): kilit omru turdan, canli konum omru tick araligindan
 * hep uzun; sinirlarin iki ucunda da.
 */

import { describe, expect, it } from 'vitest';

import { COURIER_TICK_MS_MAX, COURIER_TICK_MS_MIN } from '../../src/config/constants.js';
import { tickTiming } from '../../src/config/tick-timing.js';

describe('tickTiming', () => {
  it('varsayilan 2 sn: kilit 10 sn, butce 5 sn, canli konum 30 sn', () => {
    expect(tickTiming(2_000)).toEqual({
      intervalMs: 2_000,
      lockTtlMs: 10_000,
      budgetMs: 5_000,
      liveTtlMs: 30_000,
    });
  });

  it('kisa tick (200 ms): kilit omru alt siniri 10 sn (tek Mongo zaman asimindan uzun)', () => {
    expect(tickTiming(COURIER_TICK_MS_MIN)).toMatchObject({ lockTtlMs: 10_000, budgetMs: 5_000 });
  });

  it('uzun tick (60 sn): kilit 5 tur, canli konum 3 tur (araliktan kisa kalmaz)', () => {
    expect(tickTiming(COURIER_TICK_MS_MAX)).toEqual({
      intervalMs: 60_000,
      lockTtlMs: 300_000,
      budgetMs: 150_000,
      liveTtlMs: 180_000,
    });
  });

  it.each([COURIER_TICK_MS_MIN, 1_000, 2_000, 15_000, COURIER_TICK_MS_MAX])(
    '%i ms: butce < kilit omru, canli konum omru > aralik',
    (intervalMs) => {
      const timing = tickTiming(intervalMs);

      expect(timing.budgetMs).toBeLessThan(timing.lockTtlMs);
      expect(timing.liveTtlMs).toBeGreaterThan(intervalMs);
    },
  );
});
