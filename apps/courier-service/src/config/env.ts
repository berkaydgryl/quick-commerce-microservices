/**
 * Ortam degiskenleri. process.env YALNIZCA bu dosya uzerinden okunur.
 * Depo MOCK ile secilir: MOCK=true -> bellek (seed verisiyle dolu), aksi halde
 * COURIER_MONGO_URI zorunlu (kendi veritabani ve kullanicisi, D14).
 */

import { envInt, loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchemaFor, withoutOperationTimeout } from '@getir/mongo-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import {
  COURIER_SPEED_KMH_MAX,
  COURIER_SPEED_KMH_MIN,
  DEFAULT_COURIER_GRPC_PORT,
  DEFAULT_COURIER_SPEED_KMH,
  DEFAULT_MONGO_DB,
} from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  COURIER_GRPC_PORT: grpcPort(DEFAULT_COURIER_GRPC_PORT),
  /** Kurye hizi (km/sa): rotanin varis tahmini (T13.2). */
  COURIER_SPEED_KMH: envInt({
    min: COURIER_SPEED_KMH_MIN,
    max: COURIER_SPEED_KMH_MAX,
    defaultValue: DEFAULT_COURIER_SPEED_KMH,
  }),
});

/** Servisin kendi veritabani ve kullanicisi (D14): COURIER_MONGO_URI, COURIER_MONGO_DB. */
const mongoSchema = mongoEnvSchemaFor({ prefix: 'COURIER', defaultDb: DEFAULT_MONGO_DB });

export type CourierServiceEnv = z.infer<typeof serviceSchema> & {
  /** MOCK=true ise tanimsiz: kuryeler bellekte. */
  readonly mongo: MongoEnv | undefined;
};

export function loadServiceEnv(): CourierServiceEnv {
  const base = loadEnvOrExit(serviceSchema);
  return { ...base, mongo: base.MOCK ? undefined : loadEnvOrExit(mongoSchema) };
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
