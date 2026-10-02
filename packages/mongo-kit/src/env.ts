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
 *   MONGO_OPERATION_TIMEOUT_MS          ortak (#51): istek ve isci islemlerinin ust suresi
 */

import { envInt, envString } from '@getir/core';
import type { EnvSchema } from '@getir/core';
import { z } from 'zod';

import { NO_OPERATION_TIMEOUT } from './client.js';

/** Sunucu secimi icin beklenecek en uzun sure (ms). */
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5_000;
const MAX_SERVER_SELECTION_TIMEOUT_MS = 60_000;

/**
 * Bir islemin (ya da transaction'in) ust suresi (ms, #51). 2 sn: tekil islem 2 sn,
 * donmus Mongo'da transaction geri almayla en gec ~4 sn; ikisi de gateway'in 5 sn'lik
 * istek suresinin (GATEWAY_REQUEST_TIMEOUT_MS) altinda, once servis kendi hatasini verir.
 */
const DEFAULT_OPERATION_TIMEOUT_MS = 2_000;
const MIN_OPERATION_TIMEOUT_MS = 100;
const MAX_OPERATION_TIMEOUT_MS = 60_000;

/** Baglanti ayarlari; adlar connectMongo'nunkiyle ayni (`connectMongo({ ...mongo })`). */
export interface MongoEnv {
  readonly uri: string;
  readonly dbName: string;
  readonly serverSelectionTimeoutMs: number;
  /** Islem suresi (#51); NO_OPERATION_TIMEOUT = suresiz (yalnizca koddan: seed). */
  readonly operationTimeoutMs: number;
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
  operationTimeoutMs: z.number(),
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
      MONGO_OPERATION_TIMEOUT_MS: envInt({
        min: MIN_OPERATION_TIMEOUT_MS,
        max: MAX_OPERATION_TIMEOUT_MS,
        defaultValue: DEFAULT_OPERATION_TIMEOUT_MS,
      }),
    })
    .transform((env) =>
      // Anahtarlar servise gore degisir; degerler yukarida dogrulandi, burada
      // yalnizca sabit bicime tasinir.
      mongoEnvValues.parse({
        uri: env[uriKey],
        dbName: env[dbKey],
        serverSelectionTimeoutMs: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
        operationTimeoutMs: env.MONGO_OPERATION_TIMEOUT_MS,
      }),
    );
}

/**
 * Ayni ortam, islem suresi olmadan (#51): seed ve reseed gibi tek seferlik
 * komutlar. Toplu yazim yavas bir makinede sureye takilip yarim kalmasin; komutu
 * elle calistiran kisi bekledigini goruyor.
 */
export function withoutOperationTimeout(mongo: MongoEnv): MongoEnv {
  return { ...mongo, operationTimeoutMs: NO_OPERATION_TIMEOUT };
}
