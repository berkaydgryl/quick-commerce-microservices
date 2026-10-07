/**
 * Tick liderliginin Redis uygulamasi: lua/leader.lua (inventory supurucusunun
 * kopyasi, ADR-01 kapsam notu). Kilit tek anahtardir (redis-kit
 * COURIER_TICK_LOCK_KEY); deger ornege ozgu belirtectir, yalnizca sahibi
 * yeniler ya da birakir.
 */

import { AppError } from '@getir/core';
import type { LuaScript } from '@getir/redis-kit';
import { COURIER_TICK_LOCK_KEY } from '@getir/redis-kit';
import { z } from 'zod';

import type { LeaderLock } from '../../domain/leader-lock.js';

/** leader.lua cevabi: hold 2 alindi / 1 yenilendi / 0 baskasinda; release 1 / 0. */
const replySchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export class RedisLeaderLock implements LeaderLock {
  constructor(
    private readonly script: LuaScript,
    /** Bu ornegin belirteci: surec basina tek ve tahmin edilemez. */
    private readonly token: string,
    /** Kilit omru (ms; COURIER_TICK_LOCK_TTL_MS). */
    private readonly ttlMs: number,
  ) {}

  async hold(): Promise<boolean> {
    return (await this.run('hold')) !== 0;
  }

  async release(): Promise<void> {
    await this.run('release');
  }

  private async run(action: 'hold' | 'release'): Promise<0 | 1 | 2> {
    const parsed = replySchema.safeParse(
      await this.script.run([COURIER_TICK_LOCK_KEY], [this.token, this.ttlMs, action]),
    );
    if (!parsed.success) {
      throw AppError.internal('leader script beklenmeyen cevap verdi', { cause: parsed.error });
    }
    return parsed.data;
  }
}
