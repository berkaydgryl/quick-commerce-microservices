/**
 * Mongo kullanan her servisin ortam parcasi.
 * Sema verir, `process.env` OKUMAZ; okuma servisin kendi config/env.ts'inde olur.
 *
 * SERVIS BASINA (D14, ADR-05): her servisin KENDI veritabani ve KENDI
 * kullanicisi vardir; kullanici yalnizca kendi veritabaninda yetkilidir.
 * Butun servisler ayni kok .env'i okudugu icin degiskenler servis onekiyle
 * ayrilir (portlarla ayni desen: CATALOG_GRPC_PORT):
 *
 *   CATALOG_MONGO_URI   kullanici ve parolayi tasir; varsayilani YOK
 *   CATALOG_MONGO_DB    verilmezse servisin varsayilani (getir_catalog)
 *   MONGO_SERVER_SELECTION_TIMEOUT_MS   ortak
 */

import { envInt, envString } from '@getir/core';
import type { EnvSchema } from '@getir/core';
import { z } from 'zod';

/** Sunucu secimi icin beklenecek en uzun sure (ms). */
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5_000;
const MAX_SERVER_SELECTION_TIMEOUT_MS = 60_000;

/** Baglanti ayarlari; adlar connectMongo'nunkiyle ayni (`connectMongo({ ...mongo })`). */
export interface MongoEnv {
  readonly uri: string;
  readonly dbName: string;
  readonly serverSelectionTimeoutMs: number;
}

export interface MongoEnvNames {
  /** Degisken oneki: 'CATALOG' -> CATALOG_MONGO_URI ve CATALOG_MONGO_DB. */
  readonly prefix: string;
  /** Veritabani adi verilmezse kullanilan (getir_catalog). */
  readonly defaultDb: string;
}

const mongoEnvValues = z.object({
  uri: z.string(),
  dbName: z.string(),
  serverSelectionTimeoutMs: z.number(),
});

/**
 * Servisin Mongo ortami. Eksik ya da gecersiz degiskenin ADI hatada gorunur
 * (`CATALOG_MONGO_URI: ...`); okunan degerler connectMongo'nun bicimine cevrilir.
 */
export function mongoEnvSchemaFor(names: MongoEnvNames): EnvSchema<MongoEnv> {
  const uriKey = `${names.prefix}_MONGO_URI`;
  const dbKey = `${names.prefix}_MONGO_DB`;
  return z
    .object({
      /**
       * mongodb://kullanici:parola@host:port/?directConnection=true&authSource=admin
       *
       * Varsayilani YOK: veritabani adresi ortama gore degisir ve yanlis adrese
       * sessizce baglanmaktansa acilista olmek yeglenir. Gunluge parolasi
       * maskelenerek yazilir (redactConnectionString).
       */
      [uriKey]: envString(),
      [dbKey]: envString(names.defaultDb),
      MONGO_SERVER_SELECTION_TIMEOUT_MS: envInt({
        min: 1,
        max: MAX_SERVER_SELECTION_TIMEOUT_MS,
        defaultValue: DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
      }),
    })
    .transform((env) =>
      // Anahtarlar servise gore degisir; degerler yukarida dogrulandi, burada
      // yalnizca sabit bicime tasinir.
      mongoEnvValues.parse({
        uri: env[uriKey],
        dbName: env[dbKey],
        serverSelectionTimeoutMs: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
      }),
    );
}
