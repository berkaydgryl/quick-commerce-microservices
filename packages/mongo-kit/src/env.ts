/**
 * Mongo kullanan her servisin ortam parcasi.
 * Sema verir, `process.env` OKUMAZ; okuma servisin kendi config/env.ts'inde olur.
 */

import { envInt, envString } from '@getir/core';
import { z } from 'zod';

/** Sunucu secimi icin beklenecek en uzun sure (ms). */
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5_000;
const MAX_SERVER_SELECTION_TIMEOUT_MS = 60_000;

/** Varsayilan veritabani adi; .env.example ile ayni. */
const DEFAULT_DB_NAME = 'getir';

export const mongoEnvSchema = z.object({
  /**
   * mongodb://host:port/db?directConnection=true
   *
   * Varsayilani YOK: veritabani adresi ortama gore degisir ve yanlis adrese
   * sessizce baglanmaktansa acilista olmek yeglenir.
   */
  MONGO_URI: envString(),
  MONGO_DB: envString(DEFAULT_DB_NAME),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: envInt({
    min: 1,
    max: MAX_SERVER_SELECTION_TIMEOUT_MS,
    defaultValue: DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
  }),
});

export type MongoEnv = z.infer<typeof mongoEnvSchema>;
