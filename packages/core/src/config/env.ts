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

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
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

type EnvParseResult<TEnv> =
  | { readonly ok: true; readonly env: TEnv }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Semayi uygular; basarisizlikta sorunlu TUM alanlari "ALAN: sebep" olarak listeler. */
function parseEnv<TEnv>(schema: EnvSchema<TEnv>, source: EnvSource): EnvParseResult<TEnv> {
  const result = schema.safeParse(source);
  return result.success
    ? { ok: true, env: result.data }
    : { ok: false, problems: result.error.issues.map(describeIssue) };
}

/**
 * Ortam degiskenlerini dogrular ve tipli nesne olarak dondurur.
 * Basarisizlikta eksik/gecersiz TUM alanlari tek tek listeleyen bir AppError
 * firlatir; cagiran taraf bu hatayi yakalayip process'i sonlandirir.
 */
export function loadEnv<TEnv>(schema: EnvSchema<TEnv>, source: EnvSource = process.env): TEnv {
  const parsed = parseEnv(schema, source);
  if (parsed.ok) {
    return parsed.env;
  }
  const message = ['Ortam degiskenleri gecersiz:', ...parsed.problems.map((p) => `  - ${p}`)].join(
    '\n',
  );
  throw AppError.validation(message, { details: { issues: parsed.problems } });
}

/** Env hatasi gunluk satirinin mesaji (gunlukte aranacak sabit metin). */
export const ENV_FAILURE_MESSAGE = 'ortam degiskenleri gecersiz';

/** loadEnvOrExit'in dis dunyasi; testte sahtesi verilir. */
export interface EnvExitIo {
  /** Tek satiri (sonunda \n ile) yazar. */
  readonly write: (line: string) => void;
  readonly exit: (code: number) => void;
  readonly clock: Clock;
}

const processIo: EnvExitIo = {
  write: (line) => {
    process.stderr.write(line);
  },
  exit: (code) => process.exit(code),
  clock: systemClock,
};

/**
 * loadEnv'in acilis (bootstrap) sarmalayicisi: hata varsa TEK SATIR JSON
 * gunluk yazar ve process'i oldurur. Servis giris noktalari disinda kullanilmaz.
 *
 * NEDEN ELLE JSON: gunlukcu henuz kurulmadi - seviyesi (LOG_LEVEL) tam da
 * dogrulanamayan yapilandirmadan gelir. Bicim servislerin pino ciktisiyla
 * aynidir (level etiket olarak, time ISO-8601, msg), boylece log toplayici bu
 * satiri da okur. core bagimsiz kalir: pino'ya ya da node:fs'e dayanmaz (web
 * paketi de core'u iceri alir).
 */
export function loadEnvOrExit<TEnv>(
  schema: EnvSchema<TEnv>,
  source: EnvSource = process.env,
  io: EnvExitIo = processIo,
): TEnv {
  const parsed = parseEnv(schema, source);
  if (parsed.ok) {
    return parsed.env;
  }
  const record = {
    level: 'fatal',
    time: io.clock.date().toISOString(),
    msg: ENV_FAILURE_MESSAGE,
    issues: parsed.problems,
  };
  io.write(`${JSON.stringify(record)}\n`);
  io.exit(ENV_FAILURE_EXIT_CODE);
  // Gercek process.exit geri donmez; enjekte edilen exit dondugunde (test)
  // yarim yapilandirmayla akis devam etmesin.
  throw AppError.validation(ENV_FAILURE_MESSAGE, { details: { issues: parsed.problems } });
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
