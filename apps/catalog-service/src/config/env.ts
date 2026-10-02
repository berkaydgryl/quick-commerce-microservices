/**
 * Katalog servisinin ortam degiskenleri.
 * `process.env` TUM serviste yalnizca bu dosyada okunur.
 *
 * Iki giris noktasi var ve ihtiyaclari farkli:
 *   - servis (main.ts): MOCK=true ise Mongo'ya HIC dokunmaz; CATALOG_MONGO_URI
 *     istenmez ki frontend veritabani kurmadan calisabilsin (ADR-09).
 *   - seed (seed.ts): isi Mongo'ya yazmaktir; MOCK ne olursa olsun
 *     CATALOG_MONGO_URI zorunludur. .env.example'da MOCK=true oldugu icin bu
 *     ayrim gerekli - tek sema olsaydi seed "MOCK acik" diye Mongo'suz
 *     calismaya kalkardi.
 *
 * Dogrulanmis yapilandirma dondurulur; eksik/gecersiz degiskende process
 * acilista oler (loadEnvOrExit). Yarim yapilandirmayla ayaga kalkip ilk
 * istekte patlamaktan iyidir.
 */

import { loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchemaFor, withoutOperationTimeout } from '@getir/mongo-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import { DEFAULT_CATALOG_GRPC_PORT, DEFAULT_MONGO_DB } from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  CATALOG_GRPC_PORT: grpcPort(DEFAULT_CATALOG_GRPC_PORT),
});

/** Servisin kendi veritabani ve kullanicisi (D14): CATALOG_MONGO_URI, CATALOG_MONGO_DB. */
const mongoSchema = mongoEnvSchemaFor({ prefix: 'CATALOG', defaultDb: DEFAULT_MONGO_DB });

export type CatalogServiceEnv = z.infer<typeof serviceSchema> & {
  /** MOCK=true ise tanimsiz: veri bellekten gelir. */
  readonly mongo: MongoEnv | undefined;
};

/** Servis ortami. Mongo parcasi yalnizca MOCK kapaliyken okunur ve zorunludur. */
export function loadServiceEnv(): CatalogServiceEnv {
  const base = loadEnvOrExit(serviceSchema);
  return { ...base, mongo: base.MOCK ? undefined : loadEnvOrExit(mongoSchema) };
}

const seedSchema = z.object({
  NODE_ENV: serviceEnvSchema.shape.NODE_ENV,
  LOG_LEVEL: serviceEnvSchema.shape.LOG_LEVEL,
});

export type SeedEnv = z.infer<typeof seedSchema> & { readonly mongo: MongoEnv };

/**
 * Seed ortami: Mongo her zaman zorunlu; islem suresi YOK (#51): toplu yazim
 * sureye takilip yarim kalmasin. Goc komutu da bunu okur (gocler zaten suresiz).
 */
export function loadSeedEnv(): SeedEnv {
  return {
    ...loadEnvOrExit(seedSchema),
    mongo: withoutOperationTimeout(loadEnvOrExit(mongoSchema)),
  };
}

/** Goc komutunun ortami (T10.4): seed'inkiyle ayni ihtiyac, MOCK ne olursa olsun Mongo. */
export const loadMigrateEnv: () => SeedEnv = loadSeedEnv;

const healthcheckSchema = z.object({ CATALOG_GRPC_PORT: grpcPort(DEFAULT_CATALOG_GRPC_PORT) });

/**
 * Yalnizca saglik yoklamasinin ihtiyaci: port. Servisin TAM ortami
 * yuklenmez - yoklama Mongo adresi gibi degiskenlere bagli olmamali; bir
 * degisken eksikse servisin kendisi zaten acilista olmustur.
 */
export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).CATALOG_GRPC_PORT };
}
