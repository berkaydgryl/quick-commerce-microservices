import { describe, expect, it } from 'vitest';

import { fixedClock, systemClock } from '../../src/index.js';
import type { Clock } from '../../src/index.js';

const FIXED_EPOCH_MS = 1_700_000_000_000;
const RESERVATION_TTL_MS = 600_000;
const TOLERANCE_MS = 1_000;

describe('systemClock', () => {
  it('gercek zamani dondurur', () => {
    const before = Date.now();
    const now = systemClock.now();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('date() ile now() ayni ani gosterir', () => {
    const delta = Math.abs(systemClock.date().getTime() - systemClock.now());
    expect(delta).toBeLessThan(TOLERANCE_MS);
  });
});

describe('fixedClock', () => {
  it('sabit zamani dondurur', () => {
    const clock = fixedClock(FIXED_EPOCH_MS);
    expect(clock.now()).toBe(FIXED_EPOCH_MS);
    expect(clock.now()).toBe(FIXED_EPOCH_MS);
    expect(clock.date().toISOString()).toBe(new Date(FIXED_EPOCH_MS).toISOString());
  });

  it('advance ile TTL dolmasi beklemeden dogrulanir', () => {
    const clock = fixedClock(FIXED_EPOCH_MS);
    const expiresAt = clock.now() + RESERVATION_TTL_MS;

    expect(clock.now() < expiresAt).toBe(true);
    clock.advance(RESERVATION_TTL_MS);
    expect(clock.now() < expiresAt).toBe(false);
  });

  it('set ile zaman sifirlanabilir', () => {
    const clock = fixedClock(FIXED_EPOCH_MS);
    clock.advance(RESERVATION_TTL_MS);
    clock.set(FIXED_EPOCH_MS);
    expect(clock.now()).toBe(FIXED_EPOCH_MS);
  });

  it('date() her cagride yeni nesne dondurur', () => {
    const clock = fixedClock(FIXED_EPOCH_MS);
    const first = clock.date();
    const second = clock.date();

    expect(first).not.toBe(second);
    first.setTime(0);
    expect(clock.now()).toBe(FIXED_EPOCH_MS);
  });

  it('Clock arayuzunun yerine gecebilir', () => {
    const clock: Clock = fixedClock(FIXED_EPOCH_MS);
    expect(clock.now()).toBe(FIXED_EPOCH_MS);
  });
});
