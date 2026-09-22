/**
 * Ortam degiskeni YUKLEME POLITIKASI.
 *
 * KURAL: `process.env` tum kod tabaninda YALNIZCA bu dosyada okunur. Baska
 * hicbir modul process.env'e dokunmaz; ihtiyaci olan yapilandirmayi loadEnv'in
 * dondurdugu tipli nesneden alir. Boylece:
 *  - hangi degiskenin zorunlu oldugu tek yerde gorunur,
 *  - eksik degisken uygulamanin ilk saniyesinde patlar (gec kalmis surpriz yok),
 *  - testler gercek ortami kirletmeden kendi kaynagini verebilir.
 *
 * Tek tek degerlerin nasil ayristirildigi ayri dosyadadir: env-values.ts.
 * Ikisi ayri sebeplerle degisir - biri yeni bir tip (envUrl, envList) eklemek,
 * digeri hata/cikis politikasini degistirmek.
 */

import { z } from 'zod';

import { AppError } from '../errors.js';
import { envBoolean } from './env-values.js';

/** Ortam kaynagi; varsayilani process.env, testte duz nesne verilir. */
export type EnvSource = Record<string, string | undefined>;

/**
 * TEnv nesnesini ureten herhangi bir zod semasi.
 * Girdi tarafi `unknown`: kaynak her zaman ham ortam degiskenleridir.
 */
export type EnvSchema<TEnv> = z.ZodType<TEnv, z.ZodTypeDef, unknown>;

/** Dogrulama basarisiz oldugunda process'in donecegi cikis kodu. */
export const ENV_FAILURE_EXIT_CODE = 1;

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const DEFAULT_NODE_ENV = 'development';
const DEFAULT_LOG_LEVEL = 'info';
/** Sahte mod varsayilani: dis dunyaya cikilir. */
const DEFAULT_MOCK = false;

/** Her serviste bulunan ortak ortam parcalari. */
export const commonEnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default(DEFAULT_NODE_ENV),
  LOG_LEVEL: z.enum(LOG_LEVELS).default(DEFAULT_LOG_LEVEL),
  /** true ise dis servisler (odeme, 3DS) sahte uygulamalarla calisir. */
  MOCK: envBoolean(DEFAULT_MOCK),
});

export type CommonEnv = z.infer<typeof commonEnvSchema>;

/** Hata mesajinda tek bir sorunlu alanin gosterimi. */
function describeIssue(issue: z.ZodIssue): string {
  const field = issue.path.length > 0 ? issue.path.join('.') : '(kok)';
  return `${field}: ${issue.message}`;
}

/**
 * Ortam degiskenlerini dogrular ve tipli nesne olarak dondurur.
 * Basarisizlikta eksik/gecersiz TUM alanlari tek tek listeleyen bir AppError
 * firlatir; cagiran taraf bu hatayi yakalayip process'i sonlandirir.
 */
export function loadEnv<TEnv>(schema: EnvSchema<TEnv>, source: EnvSource = process.env): TEnv {
  const result = schema.safeParse(source);
  if (result.success) {
    return result.data;
  }

  const problems = result.error.issues.map(describeIssue);
  const message = ['Ortam degiskenleri gecersiz:', ...problems.map((p) => `  - ${p}`)].join('\n');
  throw AppError.validation(message, { details: { issues: problems } });
}

/**
 * loadEnv'in acilis (bootstrap) sarmalayicisi: hata varsa mesaji stderr'e yazar
 * ve process'i oldurur. Servis giris noktalari disinda kullanilmaz.
 */
export function loadEnvOrExit<TEnv>(
  schema: EnvSchema<TEnv>,
  source: EnvSource = process.env,
): TEnv {
  try {
    return loadEnv(schema, source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    return process.exit(ENV_FAILURE_EXIT_CODE);
  }
}

/**
 * Tek bir zorunlu degiskeni okur. Sema kurmaya degmeyen script/tooling
 * senaryolari icindir; servisler loadEnv kullanir.
 */
export function requireEnv(name: string, source: EnvSource = process.env): string {
  const raw = source[name];
  if (raw === undefined || raw.trim() === '') {
    throw AppError.validation(`Ortam degiskeni eksik: ${name}`, { details: { issues: [name] } });
  }
  return raw;
}
