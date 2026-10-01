/**
 * Redis birakmasinin servis tarafi (T10.2): on okuma (HGETALL) -> KEYS,
 * eskimis on okumada BIR kez yeniden deneme, script cevabinin semasi. Script
 * sahte; gercek release.lua test/integration/reservation.spec.ts'te.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { LuaScript, RedisConnection } from '@getir/redis-kit';
import {
  reservationIndexKey,
  reservationKey,
  stockAvailKey,
  userReservationKey,
} from '@getir/redis-kit';
import { describe, expect, it } from 'vitest';

import { RedisReservationStore } from '../../src/infrastructure/redis/redis-reservation-store.js';
import { readReservationHash } from '../../src/infrastructure/redis/reservation-hash.js';

type RedisClient = RedisConnection['redis'];

const MARKET = 'mkt_migros-jet-moda';
const ORDER = 'ord_00000000000000000000000000000001';
const USER = 'usr_00000000000000000000000000000001';
const COMMAND = { orderId: ORDER, marketId: MARKET, reason: 'user_cancelled', nowMs: 1_000 };
const OPTIONS = { holdAfterExpiryMs: 60_000, settledTtlMs: 86_400_000 };
const HASH = { 'qty:SUT-1L': '2', 'qty:KOLA-1L': '1', userId: USER, orderId: ORDER };

interface ScriptCall {
  readonly keys: readonly string[];
  readonly args: readonly (string | number)[];
}

function storeWith(hash: Record<string, string>, ...replies: unknown[]) {
  const calls: ScriptCall[] = [];
  const release: LuaScript = {
    name: 'release',
    sha: 'sahte',
    run: (keys, args = []) => {
      calls.push({ keys, args });
      return Promise.resolve(replies[Math.min(calls.length, replies.length) - 1]);
    },
  };
  const unused: LuaScript = {
    name: 'reserve',
    sha: 'sahte',
    run: () => Promise.reject(new Error('reserve cagrilmamali')),
  };
  const redis = { hgetall: () => Promise.resolve(hash) } as unknown as RedisClient;
  return {
    store: new RedisReservationStore(redis, { reserve: unused, release, commit: unused }, OPTIONS),
    calls,
  };
}

describe('RedisReservationStore.release', () => {
  it('on okumadan KEYS: hash, indeks, SKU sirasinda sayaclar, EN SONDA kullanici kilidi', async () => {
    const { store, calls } = storeWith(HASH, ['released', 0, '1', '2']);

    const outcome = await store.release(COMMAND);

    expect(calls).toEqual([
      {
        keys: [
          reservationKey(MARKET, ORDER),
          reservationIndexKey(MARKET),
          stockAvailKey(MARKET, 'KOLA-1L'),
          stockAvailKey(MARKET, 'SUT-1L'),
          userReservationKey(USER),
        ],
        args: [ORDER, USER, 'user_cancelled', 1_000, OPTIONS.settledTtlMs, 'KOLA-1L', 'SUT-1L'],
      },
    ]);
    expect(outcome).toEqual({
      status: 'released',
      skippedCounters: 0,
      lines: [
        { sku: 'KOLA-1L', quantity: 1 },
        { sku: 'SUT-1L', quantity: 2 },
      ],
    });
  });

  it('hash yoksa kullanici kilidi ve sayac bildirilmez; script yine kosar (indeks temizligi atomik)', async () => {
    const { store, calls } = storeWith({}, ['absent']);

    expect(await store.release(COMMAND)).toEqual({ status: 'absent' });
    expect(calls[0]?.keys).toEqual([reservationKey(MARKET, ORDER), reservationIndexKey(MARKET)]);
    expect(calls[0]?.args[1]).toBe('');
  });

  it('eskimis on okuma bir kez yeniden denenir', async () => {
    const { store, calls } = storeWith(HASH, ['stale'], ['released', 0, '1', '2']);

    expect((await store.release(COMMAND)).status).toBe('released');
    expect(calls).toHaveLength(2);
  });

  it('ikinci denemede de eskiyse CONFLICT (tekrar denenebilir)', async () => {
    const { store, calls } = storeWith(HASH, ['stale']);

    await expect(store.release(COMMAND)).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    expect(calls).toHaveLength(2);
  });

  it('iz: SKU/adet ciftleri kalemlere doner (SKU sirasinda)', async () => {
    const { store } = storeWith(HASH, [
      'settled',
      'released',
      'risk_rejected',
      '900',
      'SUT-1L',
      '2',
      'KOLA-1L',
      '1',
    ]);

    expect(await store.release(COMMAND)).toEqual({
      status: 'settled',
      settlement: 'released',
      reason: 'risk_rejected',
      settledAt: 900,
      lines: [
        { sku: 'KOLA-1L', quantity: 1 },
        { sku: 'SUT-1L', quantity: 2 },
      ],
    });
  });

  it('bozuk sayac INTERNAL ve hangi SKU oldugunu soyler', async () => {
    const { store } = storeWith(HASH, ['corrupt', 2]);

    await expect(store.release(COMMAND)).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
      details: { sku: 'SUT-1L' },
    });
  });

  it.each([
    ['bilinmeyen durum', ['bitti']],
    ['eksik adet', ['released', 0]],
    ['sifir adet', ['released', 0, '0']],
    ['tek kalmis sku', ['settled', 'released', 'user_cancelled', '900', 'SUT-1L']],
  ])('beklenmeyen cevap (%s) INTERNAL: tahmin yurutulmez', async (_name, reply) => {
    const { store } = storeWith(HASH, reply);

    await expect(store.release(COMMAND)).rejects.toBeInstanceOf(AppError);
    await expect(store.release(COMMAND)).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL });
  });
});

describe('rezervasyon hash on okumasi', () => {
  const where = { orderId: ORDER, marketId: MARKET };

  it('bos cevap = kayit yok', () => {
    expect(readReservationHash({}, where)).toBeUndefined();
  });

  it('kullanicisi olmayan ya da adedi bozuk kayit INTERNAL', () => {
    expect(() => readReservationHash({ 'qty:SUT-1L': '2' }, where)).toThrow(AppError);
    expect(() => readReservationHash({ ...HASH, 'qty:SUT-1L': '2.5' }, where)).toThrow(
      /bozuk adet/,
    );
  });
});
