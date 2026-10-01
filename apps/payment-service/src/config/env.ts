/**
 * Ortam degiskenleri. process.env YALNIZCA bu dosya uzerinden okunur.
 *
 * Depo MOCK ile secilir: MOCK=true -> bellek (Mongo ve Redis parcasi okunmaz,
 * olay dinleme kapali), aksi halde PAYMENT_MONGO_URI ve REDIS_URL zorunlu:
 * odemeler kendi veritabaninin (D14) `payments` koleksiyonuna yazilir, iade
 * komutlari stream:events'ten dinlenir (T7.4).
 */

import { loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchemaFor } from '@getir/mongo-kit';
import type { RedisEnv } from '@getir/redis-kit';
import { redisEnvSchema } from '@getir/redis-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import { DEFAULT_MONGO_DB, DEFAULT_PAYMENT_GRPC_PORT } from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  PAYMENT_GRPC_PORT: grpcPort(DEFAULT_PAYMENT_GRPC_PORT),
});

/** Servisin kendi veritabani ve kullanicisi (D14): PAYMENT_MONGO_URI, PAYMENT_MONGO_DB. */
const mongoSchema = mongoEnvSchemaFor({ prefix: 'PAYMENT', defaultDb: DEFAULT_MONGO_DB });

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
    : { ...base, mongo: loadEnvOrExit(mongoSchema), redis: loadEnvOrExit(redisEnvSchema) };
}

/** Goc komutunun ortami (T10.4): MOCK ne olursa olsun Mongo zorunlu (isi Mongo'dur). */
const migrateSchema = z.object({
  NODE_ENV: serviceEnvSchema.shape.NODE_ENV,
  LOG_LEVEL: serviceEnvSchema.shape.LOG_LEVEL,
});

export type MigrateEnv = z.infer<typeof migrateSchema> & { readonly mongo: MongoEnv };

export function loadMigrateEnv(): MigrateEnv {
  return { ...loadEnvOrExit(migrateSchema), mongo: loadEnvOrExit(mongoSchema) };
}

/** Saglik kontrolu yalnizca portu bilir; baska degisken istemez. */
const healthcheckSchema = z.object({
  PAYMENT_GRPC_PORT: grpcPort(DEFAULT_PAYMENT_GRPC_PORT),
});

export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).PAYMENT_GRPC_PORT };
}
