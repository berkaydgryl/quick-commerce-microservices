/**
 * Redis uzatma ve kisaltmasinin servis tarafi (T11.3): on okuma (HGETALL) ->
 * KEYS ve ARGV sirasi, eskimis on okumada bir kez yeniden deneme, script
 * cevabinin semasi. Script'ler sahte; gercek extend.lua ve shorten.lua
 * test/integration/reservation.spec.ts'te.
 */

import { ERROR_CODES } from '@getir/core';
import type { LuaScript, RedisConnection } from '@getir/redis-kit';
import { reservationIndexKey, reservationKey, userReservationKey } from '@getir/redis-kit';
import { describe, expect, it } from 'vitest';

import { RedisReservationStore } from '../../src/infrastructure/redis/redis-reservation-store.js';

type RedisClient = RedisConnection['redis'];

const MARKET = 'mkt_migros-jet-moda';
const ORDER = 'ord_00000000000000000000000000000001';
const USER = 'usr_00000000000000000000000000000001';
const OPTIONS = { holdAfterExpiryMs: 60_000, settledTtlMs: 86_400_000 };
const HASH = { 'qty:SUT-1L': '2', 'qty:KOLA-1L': '1', userId: USER, orderId: ORDER };
const EXTEND = {
  orderId: ORDER,
  marketId: MARKET,
  nowMs: 1_000,
  additionalMs: 60_000,
  maxExtensions: 3,
};
const SHORTEN = { orderId: ORDER, marketId: MARKET, nowMs: 1_000, maxRemainingMs: 120_000 };

function storeWith(hash: Record<string, string>, ...replies: unknown[]) {
  const calls: { keys: readonly string[]; args: readonly (string | number)[] }[] = [];
  const scripted: LuaScript = {
    name: 'sahte',
    sha: 'sahte',
    run: (keys, args = []) => {
      calls.push({ keys, args });
      return Promise.resolve(replies[Math.min(calls.length, replies.length) - 1]);
    },
  };
  const unused: LuaScript = {
    name: 'kullanilmaz',
    sha: 'sahte',
    run: () => Promise.reject(new Error('cagrilmamali')),
  };
  const redis = { hgetall: () => Promise.resolve(hash) } as unknown as RedisClient;
  const scripts = { reserve: unused, release: unused, commit: unused };
  return {
    extending: new RedisReservationStore(
      redis,
      { ...scripts, extend: scripted, shorten: unused },
      OPTIONS,
    ),
    shortening: new RedisReservationStore(
      redis,
      { ...scripts, extend: unused, shorten: scripted },
      OPTIONS,
    ),
    calls,
  };
}

const KEYS = [reservationKey(MARKET, ORDER), reservationIndexKey(MARKET), userReservationKey(USER)];

describe('RedisReservationStore.extend', () => {
  it('KEYS: hash, indeks, kullanici kilidi (sayac YOK); ARGV: siparis, kullanici, an, sure, pay, hak', async () => {
    const { extending, calls } = storeWith(HASH, [
      'extended',
      61_000,
      1,
      'SUT-1L',
      '2',
      'KOLA-1L',
      '1',
    ]);

    expect(await extending.extend(EXTEND)).toEqual({
      status: 'extended',
      expiresAt: 61_000,
      extensionCount: 1,
      lines: [
        { sku: 'KOLA-1L', quantity: 1 },
        { sku: 'SUT-1L', quantity: 2 },
      ],
    });
    expect(calls).toEqual([
      // 7. arguman beklenen bitis (T15.3): verilmezse bos (denetim yok).
      { keys: KEYS, args: [ORDER, USER, 1_000, 60_000, OPTIONS.holdAfterExpiryMs, 3, ''] },
    ]);
  });

  it('beklenen bitis (T15.3) 7. arguman olarak gider; mismatch cevabi guncel hal ve kalemler', async () => {
    const { extending, calls } = storeWith(HASH, ['mismatch', '61000', '1', 'SUT-1L', '2']);

    expect(await extending.extend({ ...EXTEND, expectedExpiresAt: 1_000 })).toEqual({
      status: 'expiry-mismatch',
      expiresAt: 61_000,
      extensionCount: 1,
      lines: [{ sku: 'SUT-1L', quantity: 2 }],
    });
    expect(calls[0]?.args.at(-1)).toBe(1_000);
  });

  it('hash yoksa kullanici kilidi bildirilmez; aktif olmayan cevaplar inactive', async () => {
    const { extending, calls } = storeWith({}, ['absent']);

    expect(await extending.extend(EXTEND)).toEqual({ status: 'inactive', reason: 'absent' });
    expect(calls[0]?.keys).toEqual(KEYS.slice(0, 2));
    for (const reason of ['settled', 'orphaned', 'due'] as const) {
      expect(await storeWith(HASH, [reason]).extending.extend(EXTEND)).toEqual({
        status: 'inactive',
        reason,
      });
    }
    expect(await storeWith(HASH, ['limit', '61000', '3']).extending.extend(EXTEND)).toEqual({
      status: 'limit-reached',
      expiresAt: 61_000,
      extensionCount: 3,
    });
  });

  it('eskimis on okuma bir kez yeniden denenir; yine eskiyse CONFLICT', async () => {
    const once = storeWith(HASH, ['stale'], ['limit', 61_000, 3]);
    const twice = storeWith(HASH, ['stale']);

    expect((await once.extending.extend(EXTEND)).status).toBe('limit-reached');
    await expect(twice.extending.extend(EXTEND)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(twice.calls).toHaveLength(2);
  });

  it.each([
    ['bilinmeyen durum', ['bitti']],
    ['bitissiz uzatma', ['extended']],
    ['sifir adet', ['extended', 61_000, 1, 'SUT-1L', '0']],
    ['sayisiz sinir', ['limit', 'yarin', 3]],
  ])('beklenmeyen cevap (%s) INTERNAL', async (_name, reply) => {
    await expect(storeWith(HASH, reply).extending.extend(EXTEND)).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
  });
});

describe('RedisReservationStore.shorten', () => {
  it('KEYS extend ile ayni; ARGV: siparis, kullanici, an, en cok kalan, pay', async () => {
    const { shortening, calls } = storeWith(HASH, ['shortened', 121_000]);

    expect(await shortening.shorten(SHORTEN)).toEqual({ status: 'shortened', expiresAt: 121_000 });
    expect(calls).toEqual([
      { keys: KEYS, args: [ORDER, USER, 1_000, 120_000, OPTIONS.holdAfterExpiryMs] },
    ]);
    expect(await storeWith(HASH, ['unchanged', '90000']).shortening.shorten(SHORTEN)).toEqual({
      status: 'unchanged',
      expiresAt: 90_000,
    });
    expect(await storeWith(HASH, ['due']).shortening.shorten(SHORTEN)).toEqual({
      status: 'inactive',
      reason: 'due',
    });
  });

  it('beklenmeyen cevap INTERNAL; eskimis on okuma iki kez CONFLICT', async () => {
    await expect(storeWith(HASH, ['kisaldi']).shortening.shorten(SHORTEN)).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
    await expect(storeWith(HASH, ['stale']).shortening.shorten(SHORTEN)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });
});
