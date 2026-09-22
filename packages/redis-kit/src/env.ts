/**
 * Redis kullanan her servisin ortam parcasi.
 * Sema verir, `process.env` OKUMAZ; okuma servisin kendi config/env.ts'inde olur.
 */

import { envInt, envString } from '@getir/core';
import { z } from 'zod';

/** Baglanti kurulmasi icin beklenecek en uzun sure (ms). */
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const MAX_CONNECT_TIMEOUT_MS = 60_000;

export const redisEnvSchema = z.object({
  /** redis://host:port[/db] - varsayilani YOK, eksikse servis baslangicta oler. */
  REDIS_URL: envString(),
  REDIS_CONNECT_TIMEOUT_MS: envInt({
    min: 1,
    max: MAX_CONNECT_TIMEOUT_MS,
    defaultValue: DEFAULT_CONNECT_TIMEOUT_MS,
  }),
});

export type RedisEnv = z.infer<typeof redisEnvSchema>;
