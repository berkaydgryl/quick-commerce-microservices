/**
 * Ortam degiskenleri. process.env YALNIZCA bu dosya uzerinden okunur.
 *
 * Depo MOCK ile secilir: MOCK=true -> bellek (Mongo ve Redis parcasi okunmaz,
 * olay dinleme kapali), aksi halde MONGO_URI ve REDIS_URL zorunlu: odemeler
 * `payments` koleksiyonuna yazilir, iade komutlari stream:events'ten dinlenir
 * (T7.4).
 */

import { loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchema } from '@getir/mongo-kit';
import type { RedisEnv } from '@getir/redis-kit';
import { redisEnvSchema } from '@getir/redis-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import { DEFAULT_PAYMENT_GRPC_PORT } from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  PAYMENT_GRPC_PORT: grpcPort(DEFAULT_PAYMENT_GRPC_PORT),
});

export type PaymentServiceEnv = z.infer<typeof serviceSchema> & {
  /** MOCK=true ise tanimsiz: odemeler bellekte. */
  readonly mongo: MongoEnv | undefined;
  /** MOCK=true ise tanimsiz: olay dinleme kapali (T7.4). */
  readonly redis: RedisEnv | undefined;
};

/** Servis ortami. Mongo ve Redis parcasi yalnizca MOCK kapaliyken okunur ve zorunludur. */
export function loadServiceEnv(): PaymentServiceEnv {
  const base = loadEnvOrExit(serviceSchema);
  return base.MOCK
    ? { ...base, mongo: undefined, redis: undefined }
    : { ...base, mongo: loadEnvOrExit(mongoEnvSchema), redis: loadEnvOrExit(redisEnvSchema) };
}

/** Saglik kontrolu yalnizca portu bilir; baska degisken istemez. */
const healthcheckSchema = z.object({
  PAYMENT_GRPC_PORT: grpcPort(DEFAULT_PAYMENT_GRPC_PORT),
});

export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).PAYMENT_GRPC_PORT };
}
