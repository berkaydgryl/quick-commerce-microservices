/**
 * Stok servisinin ortam degiskenleri.
 * `process.env` TUM serviste yalnizca bu dosyada okunur.
 *
 * Uc giris noktasi var ve ihtiyaclari farkli:
 *   - servis (main.ts): MOCK=true ise Mongo ve Redis'e HIC dokunmaz (stok
 *     bellekte); aksi halde MONGO_URI ve REDIS_URL zorunludur.
 *   - seed (seed.ts) ve reseed (reseed.ts): isleri Mongo ve Redis'e yazmaktir;
 *     MOCK ne olursa olsun ikisi de zorunludur (.env.example'da MOCK=true).
 *
 * Dogrulanmis yapilandirma dondurulur; eksik/gecersiz degiskende process
 * acilista oler (loadEnvOrExit).
 */

import { loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchema } from '@getir/mongo-kit';
import type { RedisEnv } from '@getir/redis-kit';
import { redisEnvSchema } from '@getir/redis-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import { DEFAULT_INVENTORY_GRPC_PORT } from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  INVENTORY_GRPC_PORT: grpcPort(DEFAULT_INVENTORY_GRPC_PORT),
});

/** Kalici stok (Mongo) ve hizli sayac (Redis) baglantilari (ADR-03). */
export interface StockStoresEnv {
  readonly mongo: MongoEnv;
  readonly redis: RedisEnv;
}

export type InventoryServiceEnv = z.infer<typeof serviceSchema> & {
  /** MOCK=true ise tanimsiz: stok bellekte. */
  readonly stores: StockStoresEnv | undefined;
};

/** Servis ortami. Depo parcasi yalnizca MOCK kapaliyken okunur ve zorunludur. */
export function loadServiceEnv(): InventoryServiceEnv {
  const base = loadEnvOrExit(serviceSchema);
  return { ...base, stores: base.MOCK ? undefined : loadStoresEnv() };
}

function loadStoresEnv(): StockStoresEnv {
  return { mongo: loadEnvOrExit(mongoEnvSchema), redis: loadEnvOrExit(redisEnvSchema) };
}

const commandSchema = z.object({
  NODE_ENV: serviceEnvSchema.shape.NODE_ENV,
  LOG_LEVEL: serviceEnvSchema.shape.LOG_LEVEL,
});

export type CommandEnv = z.infer<typeof commandSchema> & StockStoresEnv;

/** Seed ve reseed komutlarinin ortami: Mongo ve Redis her zaman zorunlu. */
export function loadCommandEnv(): CommandEnv {
  return { ...loadEnvOrExit(commandSchema), ...loadStoresEnv() };
}

const healthcheckSchema = z.object({
  INVENTORY_GRPC_PORT: grpcPort(DEFAULT_INVENTORY_GRPC_PORT),
});

/**
 * Yalnizca saglik yoklamasinin ihtiyaci: port. Servisin TAM ortami
 * yuklenmez; bir degisken eksikse servisin kendisi zaten acilista olmustur.
 */
export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).INVENTORY_GRPC_PORT };
}
