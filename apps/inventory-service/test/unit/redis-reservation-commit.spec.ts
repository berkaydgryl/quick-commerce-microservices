/**
 * Redis onayinin servis tarafi (T10.2 PR 2): on okuma (HGETALL) -> KEYS (sayac
 * YOK, onay sayaclara dokunmaz), eskimis on okumada bir kez yeniden deneme,
 * script cevabinin semasi. Script sahte; gercek commit.lua
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
const COMMAND = { orderId: ORDER, marketId: MARKET, nowMs: 1_000 };
const OPTIONS = { holdAfterExpiryMs: 60_000, settledTtlMs: 86_400_000 };
const HASH = { 'qty:SUT-1L': '2', 'qty:KOLA-1L': '1', userId: USER, orderId: ORDER };

function storeWith(hash: Record<string, string>, ...replies: unknown[]) {
  const calls: { keys: readonly string[]; args: readonly (string | number)[] }[] = [];
  const commit: LuaScript = {
    name: 'commit',
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
  return {
    store: new RedisReservationStore(
      redis,
      { reserve: unused, release: unused, commit, extend: unused, shorten: unused },
      OPTIONS,
    ),
    calls,
  };
}

describe('RedisReservationStore.commit', () => {
  it('KEYS: hash, indeks ve kullanici kilidi; SAYAC YOK. Kalemler SKU sirasinda', async () => {
    const { store, calls } = storeWith(HASH, ['committed', 'SUT-1L', '2', 'KOLA-1L', '1']);

    const outcome = await store.commit(COMMAND);

    expect(calls).toEqual([
      {
        keys: [
          reservationKey(MARKET, ORDER),
          reservationIndexKey(MARKET),
          userReservationKey(USER),
        ],
        args: [ORDER, USER, 'order_paid', 1_000, OPTIONS.settledTtlMs],
      },
    ]);
    expect(outcome).toEqual({
      status: 'committed',
      lines: [
        { sku: 'KOLA-1L', quantity: 1 },
        { sku: 'SUT-1L', quantity: 2 },
      ],
    });
  });

  it('hash yoksa kullanici kilidi bildirilmez; script yine kosar', async () => {
    const { store, calls } = storeWith({}, ['absent']);

    expect(await store.commit(COMMAND)).toEqual({ status: 'absent' });
    expect(calls[0]?.keys).toEqual([reservationKey(MARKET, ORDER), reservationIndexKey(MARKET)]);
  });

  it('iz: birakilmis ya da onaylanmis', async () => {
    const released = storeWith(HASH, [
      'settled',
      'released',
      'user_cancelled',
      '900',
      'SUT-1L',
      '2',
    ]);

    expect(await released.store.commit(COMMAND)).toEqual({
      status: 'settled',
      settlement: 'released',
      reason: 'user_cancelled',
      settledAt: 900,
      lines: [{ sku: 'SUT-1L', quantity: 2 }],
    });
  });

  it('eskimis on okuma bir kez yeniden denenir; yine eskiyse CONFLICT', async () => {
    const once = storeWith(HASH, ['stale'], ['committed', 'SUT-1L', '2']);
    const twice = storeWith(HASH, ['stale']);

    expect((await once.store.commit(COMMAND)).status).toBe('committed');
    await expect(twice.store.commit(COMMAND)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(twice.calls).toHaveLength(2);
  });

  it.each([
    ['bilinmeyen durum', ['bitti']],
    ['bilinmeyen iz durumu', ['settled', 'archived', 'x', '900']],
    ['sifir adet', ['committed', 'SUT-1L', '0']],
    ['tek kalmis sku', ['committed', 'SUT-1L']],
  ])('beklenmeyen cevap (%s) INTERNAL', async (_name, reply) => {
    const { store } = storeWith(HASH, reply);

    await expect(store.commit(COMMAND)).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL });
  });
});
