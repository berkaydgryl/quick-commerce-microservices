import { AppError } from '@getir/core';
import type { RedisConnection } from '@getir/redis-kit';
import { describe, expect, it } from 'vitest';

import { assertNoEviction } from '../../src/infrastructure/redis/eviction-policy.js';

type RedisClient = RedisConnection['redis'];

/** Yalnizca CONFIG GET'i taklit eden istemci. */
function redisAnswering(config: () => Promise<unknown>): RedisClient {
  return { config } as unknown as RedisClient;
}

describe('Redis tahliye politikasi (P1)', () => {
  it('noeviction ise gecer', async () => {
    await expect(
      assertNoEviction(redisAnswering(() => Promise.resolve(['maxmemory-policy', 'noeviction']))),
    ).resolves.toBeUndefined();
  });

  it('tahliye eden politikada servis acilmaz; mesaj sebebi soyler', async () => {
    const check = assertNoEviction(
      redisAnswering(() => Promise.resolve(['maxmemory-policy', 'allkeys-lru'])),
    );

    await expect(check).rejects.toBeInstanceOf(AppError);
    await expect(check).rejects.toThrow(/allkeys-lru.*noeviction zorunlu/);
  });

  it('politika okunamazsa (CONFIG kapali) da acilmaz', async () => {
    await expect(
      assertNoEviction(
        redisAnswering(() => Promise.reject(new Error('ERR unknown command CONFIG'))),
      ),
    ).rejects.toThrow(/okunamadi/);
  });

  it('beklenmeyen cevap bicimi de reddedilir', async () => {
    await expect(
      assertNoEviction(redisAnswering(() => Promise.resolve('noeviction'))),
    ).rejects.toThrow(/noeviction zorunlu/);
  });
});
