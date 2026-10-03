/**
 * Ortam degiskenleri. process.env YALNIZCA bu dosya uzerinden okunur.
 *
 * MOCK=true: Redis'siz calisir (bellek adapter'i; tek kopya). Oda jetonu sirri
 * verilmezse siparis odalari KAPALI kalir, market odalari acik (D3): imaj
 * denetimi servisi yalnizca MOCK=true ile ve agsiz acar.
 * MOCK=false: REDIS_URL ve REALTIME_TOKEN_SECRET zorunlu.
 */

import { commonEnvSchema, envInt, envOptionalHttpUrl, loadEnvOrExit } from '@getir/core';
import { redisEnvSchema } from '@getir/redis-kit';
import type { RedisEnv } from '@getir/redis-kit';
import { MAX_GRPC_PORT, MIN_PORT } from '@getir/service-kit';
import { z } from 'zod';

import {
  DEFAULT_REALTIME_PORT,
  EXAMPLE_TOKEN_SECRET,
  MIN_TOKEN_SECRET_BYTES,
} from './constants.js';

/**
 * Port: metrik ucu bunun 1000 ustunde acildigi icin ust sinir gRPC portlariyla
 * ayni (MAX_GRPC_PORT, T10.5 kurali).
 */
const portSchema = envInt({
  min: MIN_PORT,
  max: MAX_GRPC_PORT,
  defaultValue: DEFAULT_REALTIME_PORT,
});

/** Bos ya da yalnizca bosluk: verilmemis sayilir (compose "X=" bos metin gecirir). */
const optionalSecretSchema = z
  .string()
  .optional()
  .transform((raw) => {
    const text = raw?.trim() ?? '';
    return text === '' ? undefined : text;
  });

export const realtimeEnvSchema = commonEnvSchema
  .extend({
    REALTIME_PORT: portSchema,
    /** Oda jetonu sirri (HS256, gateway ile AYNI deger; JWT_SECRET'tan farkli). */
    REALTIME_TOKEN_SECRET: optionalSecretSchema,
    /** Izlerin OTLP/HTTP adresi (D15). Bossa izler olusur ama disari gonderilmez. */
    OTEL_EXPORTER_OTLP_ENDPOINT: envOptionalHttpUrl(),
  })
  .superRefine((env, ctx) => {
    const problem = tokenSecretProblem(env.REALTIME_TOKEN_SECRET, env);
    if (problem !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REALTIME_TOKEN_SECRET'],
        message: problem,
      });
    }
  });

export type RealtimeServiceEnv = z.infer<typeof realtimeEnvSchema> & {
  /** MOCK=true ise tanimsiz: bellek adapter'i, Redis'e baglanilmaz. */
  readonly redis: RedisEnv | undefined;
};

/**
 * Sirrin kurali; sorun yoksa undefined. Mesaj DEGERI icermez (sir gunluge sizmasin).
 * Gateway'deki JWT_SECRET kuralinin aynisi; JWT_SECRET'la esitligi gateway denetler
 * (realtime JWT_SECRET'i bilmez).
 */
export function tokenSecretProblem(
  secret: string | undefined,
  env: { readonly MOCK: boolean; readonly NODE_ENV: string },
): string | undefined {
  if (secret === undefined) {
    return env.MOCK
      ? undefined
      : `zorunlu (MOCK=false), en az ${MIN_TOKEN_SECRET_BYTES} bayt; gateway ile ayni deger olmali`;
  }
  const bytes = Buffer.byteLength(secret, 'utf8');
  if (bytes < MIN_TOKEN_SECRET_BYTES) {
    return `en az ${MIN_TOKEN_SECRET_BYTES} bayt olmali, verilen ${bytes} bayt`;
  }
  if (env.NODE_ENV === 'production' && secret === EXAMPLE_TOKEN_SECRET) {
    return "production'da .env.example'daki ornek sir kullanilamaz";
  }
  return undefined;
}

export function loadServiceEnv(): RealtimeServiceEnv {
  const base = loadEnvOrExit(realtimeEnvSchema);
  return { ...base, redis: base.MOCK ? undefined : loadEnvOrExit(redisEnvSchema) };
}

const healthcheckSchema = z.object({ REALTIME_PORT: portSchema });

export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).REALTIME_PORT };
}
