/**
 * Ortam degiskenleri. process.env YALNIZCA bu dosya uzerinden okunur.
 * Depo MOCK ile secilir: MOCK=true -> bellek (seed verisiyle dolu; Redis yok,
 * kilometre tasi olaylari yayinlanmaz), aksi halde COURIER_MONGO_URI (kendi
 * veritabani ve kullanicisi, D14) ve REDIS_URL (tick liderligi, olaylar,
 * canli konum; T13.3) zorunlu.
 */

import { envInt, loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchemaFor, withoutOperationTimeout } from '@getir/mongo-kit';
import type { RedisEnv } from '@getir/redis-kit';
import { redisEnvSchema } from '@getir/redis-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import {
  COURIER_SPEED_KMH_MAX,
  COURIER_SPEED_KMH_MIN,
  COURIER_TICK_MS_MAX,
  COURIER_TICK_MS_MIN,
  DEFAULT_COURIER_GRPC_PORT,
  DEFAULT_COURIER_SPEED_KMH,
  DEFAULT_COURIER_TICK_MS,
  DEFAULT_MONGO_DB,
  DEFAULT_ORDER_PREP_SECONDS,
  ORDER_PREP_SECONDS_MAX,
  ORDER_PREP_SECONDS_MIN,
} from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  COURIER_GRPC_PORT: grpcPort(DEFAULT_COURIER_GRPC_PORT),
  /** Kurye hizi (km/sa): rotanin varis tahmini (T13.2). */
  COURIER_SPEED_KMH: envInt({
    min: COURIER_SPEED_KMH_MIN,
    max: COURIER_SPEED_KMH_MAX,
    defaultValue: DEFAULT_COURIER_SPEED_KMH,
  }),
  /** Tick araligi (ms; T13.3): rotalar bu aralikla ilerler. */
  COURIER_TICK_MS: envInt({
    min: COURIER_TICK_MS_MIN,
    max: COURIER_TICK_MS_MAX,
    defaultValue: DEFAULT_COURIER_TICK_MS,
  }),
  /** Siparisin markette hazirlanma suresi (sn; T13.3): kurye erken varirsa bekler. */
  ORDER_PREP_SECONDS: envInt({
    min: ORDER_PREP_SECONDS_MIN,
    max: ORDER_PREP_SECONDS_MAX,
    defaultValue: DEFAULT_ORDER_PREP_SECONDS,
  }),
});

/** Servisin kendi veritabani ve kullanicisi (D14): COURIER_MONGO_URI, COURIER_MONGO_DB. */
const mongoSchema = mongoEnvSchemaFor({ prefix: 'COURIER', defaultDb: DEFAULT_MONGO_DB });

export type CourierServiceEnv = z.infer<typeof serviceSchema> & {
  /** MOCK=true ise tanimsiz: kuryeler bellekte. */
  readonly mongo: MongoEnv | undefined;
  /** MOCK=true ise tanimsiz: tick hep lider, olaylar yayinlanmaz (T13.3). */
  readonly redis: RedisEnv | undefined;
};

/** Servis ortami. Mongo ve Redis parcasi yalnizca MOCK kapaliyken okunur ve zorunludur. */
export function loadServiceEnv(): CourierServiceEnv {
  const base = loadEnvOrExit(serviceSchema);
  return base.MOCK
    ? { ...base, mongo: undefined, redis: undefined }
    : { ...base, mongo: loadEnvOrExit(mongoSchema), redis: loadEnvOrExit(redisEnvSchema) };
}

/**
 * Seed ve goc komutlarinin ortami: MOCK ne olursa olsun Mongo zorunlu (isleri
 * Mongo'dur). Islem suresi yok: komut bir kez kosar, istek yolunda degildir.
 */
const commandSchema = z.object({
  NODE_ENV: serviceEnvSchema.shape.NODE_ENV,
  LOG_LEVEL: serviceEnvSchema.shape.LOG_LEVEL,
});

export type CommandEnv = z.infer<typeof commandSchema> & { readonly mongo: MongoEnv };

export function loadCommandEnv(): CommandEnv {
  return {
    ...loadEnvOrExit(commandSchema),
    mongo: withoutOperationTimeout(loadEnvOrExit(mongoSchema)),
  };
}

const healthcheckSchema = z.object({ COURIER_GRPC_PORT: grpcPort(DEFAULT_COURIER_GRPC_PORT) });

/**
 * Yalnizca saglik yoklamasinin ihtiyaci: port. Yoklama Mongo adresine bagli
 * olmamali; bir degisken eksikse servisin kendisi zaten acilista olmustur.
 */
export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).COURIER_GRPC_PORT };
}
