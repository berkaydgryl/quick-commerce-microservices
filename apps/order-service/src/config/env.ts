/**
 * Siparis servisinin ortam degiskenleri.
 * `process.env` TUM serviste yalnizca bu dosyada okunur.
 *
 * MOCK=true ise siparisler BELLEKTE tutulur ve ORDER_MONGO_URI / REDIS_URL istenmez:
 * frontend veritabani kurmadan calisabilsin (ADR-09); olaylar bellekte kalir,
 * yayinci calismaz. MOCK kapaliyken Mongo ve Redis (outbox yayini, T7.3) zorunludur;
 * eksik degiskende process acilista oler (loadEnvOrExit) - yarim
 * yapilandirmayla ayaga kalkip ilk siparisde patlamaktan iyidir.
 */

import { envString, loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchemaFor } from '@getir/mongo-kit';
import type { RedisEnv } from '@getir/redis-kit';
import { redisEnvSchema } from '@getir/redis-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import {
  DEFAULT_CATALOG_GRPC_ADDR,
  DEFAULT_MONGO_DB,
  DEFAULT_ORDER_GRPC_PORT,
  DEFAULT_PAYMENT_GRPC_ADDR,
  DEFAULT_RISK_GRPC_ADDR,
} from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  ORDER_GRPC_PORT: grpcPort(DEFAULT_ORDER_GRPC_PORT),
  // Fiyatlar catalog'dan okunur (T7.2). Ad gateway'le ayni: iki servis ayni
  // catalog'a ayni degiskenle baglanir.
  CATALOG_GRPC_ADDR: envString(DEFAULT_CATALOG_GRPC_ADDR),
  // Siparis saga'si (T7.1): risk degerlendirmesi ve odeme.
  RISK_GRPC_ADDR: envString(DEFAULT_RISK_GRPC_ADDR),
  PAYMENT_GRPC_ADDR: envString(DEFAULT_PAYMENT_GRPC_ADDR),
});

/** Servisin kendi veritabani ve kullanicisi (D14): ORDER_MONGO_URI, ORDER_MONGO_DB. */
const mongoSchema = mongoEnvSchemaFor({ prefix: 'ORDER', defaultDb: DEFAULT_MONGO_DB });

export type OrderServiceEnv = z.infer<typeof serviceSchema> & {
  /** MOCK=true ise tanimsiz: siparisler bellekte. */
  readonly mongo: MongoEnv | undefined;
  /** MOCK=true ise tanimsiz: olaylar bellekte, yayinci kapali (T7.3). */
  readonly redis: RedisEnv | undefined;
};

/** Servis ortami. Mongo ve Redis parcasi yalnizca MOCK kapaliyken okunur ve zorunludur. */
export function loadServiceEnv(): OrderServiceEnv {
  const base = loadEnvOrExit(serviceSchema);
  return base.MOCK
    ? { ...base, mongo: undefined, redis: undefined }
    : { ...base, mongo: loadEnvOrExit(mongoSchema), redis: loadEnvOrExit(redisEnvSchema) };
}

const seedSchema = z.object({
  NODE_ENV: serviceEnvSchema.shape.NODE_ENV,
  LOG_LEVEL: serviceEnvSchema.shape.LOG_LEVEL,
});

export type SeedEnv = z.infer<typeof seedSchema> & { readonly mongo: MongoEnv };

/**
 * Persona seed'inin ortami (T8.1): Mongo HER ZAMAN zorunlu (seed'in isi Mongo'ya
 * yazmaktir; MOCK'ta gecmis acilista bellege yuklenir). catalog seed'iyle ayni.
 */
export function loadSeedEnv(): SeedEnv {
  return { ...loadEnvOrExit(seedSchema), mongo: loadEnvOrExit(mongoSchema) };
}

/** Goc komutunun ortami (T10.4): seed'inkiyle ayni ihtiyac, MOCK ne olursa olsun Mongo. */
export const loadMigrateEnv: () => SeedEnv = loadSeedEnv;

const healthcheckSchema = z.object({ ORDER_GRPC_PORT: grpcPort(DEFAULT_ORDER_GRPC_PORT) });

/**
 * Yalnizca saglik yoklamasinin ihtiyaci: port. Servisin TAM ortami
 * yuklenmez - yoklama Mongo adresi gibi degiskenlere bagli olmamali; bir
 * degisken eksikse servisin kendisi zaten acilista olmustur.
 */
export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).ORDER_GRPC_PORT };
}
