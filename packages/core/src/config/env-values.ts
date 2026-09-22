/**
 * Ortam degiskeni DEGER AYRISTIRICILARI.
 *
 * Buradaki her fonksiyon tek bir soruyu cevaplar: "bu ham metin, istedigim
 * tipte gecerli bir deger mi?" Yukleme politikasi (hangi degiskenler zorunlu,
 * hata olursa ne yapilir) ayri dosyadadir: env.ts.
 *
 * Ortak kural: TANIMSIZ ile BOS METIN ayni sayilir. Sebep pratik -
 * docker-compose'da "GRPC_HOST=" yazmak degiskeni bos string olarak gecirir ve
 * zod'un `.default()` bunu TANIMLI kabul edip varsayilani uygulamaz; servis de
 * bos adrese baglanmaya calisirdi.
 */

import { z } from 'zod';

const TRUE_LITERALS = new Set(['1', 'true', 'yes', 'on']);
const FALSE_LITERALS = new Set(['0', 'false', 'no', 'off']);
const INTEGER_PATTERN = /^-?\d+$/;

const DECIMAL_RADIX = 10;

/** "1" / "true" / "on" gibi metinleri boolean'a cevirir. */
export function envBoolean(defaultValue = false) {
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
