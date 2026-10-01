/**
 * Stok servisinin ortam semasi: supurucu ayarlari (T10.3, .env.example ile ayni
 * varsayilanlar) ve kilit omrunun turdan belirgin buyuk olma kurali.
 */

import { AppError, loadEnv } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { serviceSchema } from '../../src/config/env.js';

describe('stok servisi ortami (supurucu, T10.3)', () => {
  it('verilmezse tur 1 sn, kilit omru 3 sn (.env.example)', () => {
    const env = loadEnv(serviceSchema, {});

    expect(env.SWEEPER_INTERVAL_MS).toBe(1_000);
    expect(env.SWEEPER_LOCK_TTL_SECONDS).toBe(3);
  });

  it('kilit omru en az iki tur olmali; degilse acilis durur', () => {
    expect(() =>
      loadEnv(serviceSchema, { SWEEPER_INTERVAL_MS: '2000', SWEEPER_LOCK_TTL_SECONDS: '3' }),
    ).toThrow(AppError);
    expect(() =>
      loadEnv(serviceSchema, { SWEEPER_INTERVAL_MS: '2000', SWEEPER_LOCK_TTL_SECONDS: '3' }),
    ).toThrow(/SWEEPER_LOCK_TTL_SECONDS/);
    expect(
      loadEnv(serviceSchema, { SWEEPER_INTERVAL_MS: '500', SWEEPER_LOCK_TTL_SECONDS: '1' })
        .SWEEPER_LOCK_TTL_SECONDS,
    ).toBe(1);
  });

  it('tur sinirlari: 100 ms ile 60 sn arasi', () => {
    expect(() => loadEnv(serviceSchema, { SWEEPER_INTERVAL_MS: '50' })).toThrow(AppError);
    expect(() => loadEnv(serviceSchema, { SWEEPER_INTERVAL_MS: '60001' })).toThrow(AppError);
  });
});
