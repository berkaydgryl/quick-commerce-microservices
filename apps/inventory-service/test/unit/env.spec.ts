/**
 * Stok servisinin ortam semasi: supurucu ayarlari (T10.3, .env.example ile ayni
 * varsayilanlar) ve kilit omrunun turdan belirgin buyuk olma kurali.
 */

import { AppError, loadEnv } from '@getir/core';
import { NO_OPERATION_TIMEOUT } from '@getir/mongo-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadCommandEnv, loadServiceEnv, serviceSchema } from '../../src/config/env.js';

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

describe('stok servisi ortami: uzatma hakki (T11.3, B21)', () => {
  it('verilmezse 3 (.env.example); 0 uzatmayi kapatir; 0-10 disi acilisi durdurur', () => {
    expect(loadEnv(serviceSchema, {}).RESERVATION_MAX_EXTENSIONS).toBe(3);
    expect(
      loadEnv(serviceSchema, { RESERVATION_MAX_EXTENSIONS: '0' }).RESERVATION_MAX_EXTENSIONS,
    ).toBe(0);
    expect(() => loadEnv(serviceSchema, { RESERVATION_MAX_EXTENSIONS: '-1' })).toThrow(AppError);
    expect(() => loadEnv(serviceSchema, { RESERVATION_MAX_EXTENSIONS: '11' })).toThrow(
      /RESERVATION_MAX_EXTENSIONS/,
    );
  });
});

describe('stok servisi ortami: Mongo islem suresi (#51)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('servis MONGO_OPERATION_TIMEOUT_MS ile baglanir; seed ve reseed suresiz', () => {
    vi.stubEnv('MOCK', 'false');
    vi.stubEnv(
      'INVENTORY_MONGO_URI',
      'mongodb://inventory:parola@localhost:27017/?directConnection=true&authSource=admin',
    );
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('MONGO_OPERATION_TIMEOUT_MS', '750');

    expect(loadServiceEnv().stores?.mongo.operationTimeoutMs).toBe(750);
    expect(loadCommandEnv().mongo.operationTimeoutMs).toBe(NO_OPERATION_TIMEOUT);
  });
});
