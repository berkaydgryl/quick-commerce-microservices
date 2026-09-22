/**
 * Ortam degiskeni yukleme ve dogrulama.
 *
 * KURAL: `process.env` tum kod tabaninda YALNIZCA bu dosyada okunur. Baska hicbir
 * modul process.env'e dokunmaz; ihtiyaci olan yapilandirmayi loadEnv'in dondurdugu
 * tipli nesneden alir. Boylece:
 *  - hangi degiskenin zorunlu oldugu tek yerde gorunur,
 *  - eksik degisken uygulamanin ilk saniyesinde patlar (gec kalmis surpriz yok),
 *  - testler gercek ortami kirletmeden kendi kaynagini verebilir.
 */

import { z } from 'zod';

import { AppError } from '../errors.js';

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
const DEFAULT_MOCK = false;

const TRUE_LITERALS = new Set(['1', 'true', 'yes', 'on']);
const FALSE_LITERALS = new Set(['0', 'false', 'no', 'off']);
const INTEGER_PATTERN = /^-?\d+$/;

const DECIMAL_RADIX = 10;

/** "1" / "true" / "on" gibi metinleri boolean'a cevirir. */
export function envBoolean(defaultValue: boolean = DEFAULT_MOCK) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const text = raw?.trim().toLowerCase() ?? '';
      if (text === '') {
        return defaultValue;
      }
      if (TRUE_LITERALS.has(text)) {
        return true;
      }
      if (FALSE_LITERALS.has(text)) {
        return false;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `boolean bekleniyor (1/0, true/false, yes/no, on/off), alinan: "${raw ?? ''}"`,
      });
      return z.NEVER;
    });
}

/**
 * Metin ortam degiskeni.
 *
 * Tanimsiz VE bos metin ayni sayilir: docker-compose'da "GRPC_HOST=" yazmak
 * degiskeni bos string olarak gecirir; zod'un `.default()` bunu TANIMLI kabul
 * edip varsayilani uygulamaz ve uygulama bos adrese baglanmaya calisirdi.
 *
 * Varsayilan verilmezse degisken ZORUNLUDUR (envInt ile ayni kural).
 */
export function envString(defaultValue?: string) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const text = raw?.trim() ?? '';
      if (text !== '') {
        return text;
      }
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'zorunlu alan eksik' });
      return z.NEVER;
    });
}

export interface EnvIntOptions {
  readonly min?: number;
  readonly max?: number;
  /** Verilmezse degisken zorunludur. */
  readonly defaultValue?: number;
}

/** Tam sayi ortam degiskeni (port, TTL, aralik...). Float kabul edilmez. */
export function envInt(options: EnvIntOptions = {}) {
  const { min, max, defaultValue } = options;
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const text = raw?.trim() ?? '';
      if (text === '') {
        if (defaultValue !== undefined) {
          return defaultValue;
        }
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'zorunlu alan eksik' });
        return z.NEVER;
      }
      if (!INTEGER_PATTERN.test(text)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tam sayi bekleniyor, alinan: "${text}"`,
        });
        return z.NEVER;
      }
      const parsed = Number.parseInt(text, DECIMAL_RADIX);
      if (min !== undefined && parsed < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `en az ${min} olmali, alinan: ${parsed}`,
        });
        return z.NEVER;
      }
      if (max !== undefined && parsed > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `en fazla ${max} olmali, alinan: ${parsed}`,
        });
        return z.NEVER;
      }
      return parsed;
    });
}

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
