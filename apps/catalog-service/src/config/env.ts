/**
 * Katalog servisinin ortam degiskenleri.
 * `process.env` TUM serviste yalnizca bu dosyada okunur.
 *
 * Iki giris noktasi var ve ihtiyaclari farkli:
 *   - servis (main.ts): MOCK=true ise Mongo'ya HIC dokunmaz; MONGO_URI
 *     istenmez ki frontend veritabani kurmadan calisabilsin (ADR-09).
 *   - seed (seed.ts): isi Mongo'ya yazmaktir; MOCK ne olursa olsun MONGO_URI
 *     zorunludur. .env.example'da MOCK=true oldugu icin bu ayrim gerekli -
 *     tek sema olsaydi seed "MOCK acik" diye Mongo'suz calismaya kalkardi.
 *
 * Dogrulanmis yapilandirma dondurulur; eksik/gecersiz degiskende process
 * acilista oler (loadEnvOrExit). Yarim yapilandirmayla ayaga kalkip ilk
 * istekte patlamaktan iyidir.
 */

import { loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchema } from '@getir/mongo-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import type { z } from 'zod';

import { DEFAULT_CATALOG_GRPC_PORT } from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  CATALOG_GRPC_PORT: grpcPort(DEFAULT_CATALOG_GRPC_PORT),
});

export type CatalogServiceEnv = z.infer<typeof serviceSchema> & {
  /** MOCK=true ise tanimsiz: veri bellekten gelir. */
  readonly mongo: MongoEnv | undefined;
};

/** Servis ortami. Mongo parcasi yalnizca MOCK kapaliyken okunur ve zorunludur. */
export function loadServiceEnv(): CatalogServiceEnv {
  const base = loadEnvOrExit(serviceSchema);
  return { ...base, mongo: base.MOCK ? undefined : loadEnvOrExit(mongoEnvSchema) };
}

const seedSchema = mongoEnvSchema.extend({
  NODE_ENV: serviceEnvSchema.shape.NODE_ENV,
  LOG_LEVEL: serviceEnvSchema.shape.LOG_LEVEL,
});

export type SeedEnv = z.infer<typeof seedSchema>;

/** Seed ortami: Mongo her zaman zorunlu. */
export function loadSeedEnv(): SeedEnv {
  return loadEnvOrExit(seedSchema);
}
