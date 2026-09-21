/**
 * Tek bicimli cevap zarfi.
 *
 * Gateway'den cikan HER cevap bu zarftadir; istemci tek yerde acar ve her uc
 * icin ayri kontrol yazmaz. Socket ack govdesi de ayni zarfi kullanir
 * (docs/api/socket-events.md).
 *
 * HATA BILGISI GRUPLUDUR: code, message, details ve requestId tek bir `error`
 * nesnesinin icinde durur; kokte ayrica bir `message` alani YOKTUR. Iki
 * gerekce:
 *   1. Hatanin tamami tek parca halinde tasinabilir - toast'a, loglayiciya ya
 *      da hata izleme aracina oldugu gibi verilir, alan toplamak gerekmez.
 *   2. getir.common.v1.ErrorDetail de ayni sekilde grupludur (code + message +
 *      metadata). Boylece gateway'in gRPC hatasini REST'e cevirmesi alan
 *      tasima degil neredeyse birebir esleme olur.
 */

import { ERROR_CODES } from '@getir/core';
import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';

/**
 * Hata kodu sozlugu.
 *
 * TEK KAYNAK @getir/core icindeki ERROR_CODES'tur; burada yeniden
 * TANIMLANMAZ, yalnizca semaya donusturulur. Core'a yeni bir kod eklendiginde
 * bu sema kendiliginde genisler ve ERROR_MESSAGES sozlugu eksik kalirsa
 * derleme kirilir (bkz. errors.ts).
 */
export const errorCodeSchema = z.nativeEnum(ERROR_CODES);

/** Makine tarafindan okunan hata govdesi. */
export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  /** Kullaniciya gosterilebilir Turkce aciklama. */
  message: z.string(),
  /**
   * Koda ozgu ek baglam: alan hatalari, yetersiz stok miktari, risk skoru.
   * null gelebilir; "alan yok" ile "deger bos" ayrimini korumak icin nullable
   * ve optional birlikte kullanilir.
   */
  details: z.record(z.unknown()).nullable().optional(),
  /** X-Request-Id basligi ile ayni deger; logdaki kayitla eslesir. */
  requestId: z.string(),
});

/** Cevaba iliskin ust veri; is verisi degildir. */
export const responseMetaSchema = z.object({
  requestId: z.string().optional(),
  servedAt: isoDateTimeSchema.optional(),
});

/** Zarfin hata kolu. */
export const apiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
});

/**
 * Zarfin basari kolu. `data` uca gore degistigi icin sema bir FABRIKADIR.
 *
 * Ornek: apiSuccessResponseSchema(productSchema.array())
 */
export function apiSuccessResponseSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.literal(true),
    data,
    meta: responseMetaSchema.optional(),
  });
}

/**
 * Tam zarf: basari ya da hata. `success` ayirt edici alandir.
 *
 * Ornek: apiResponseSchema(orderSchema)
 */
export function apiResponseSchema<T extends z.ZodTypeAny>(data: T) {
  return z.discriminatedUnion('success', [apiSuccessResponseSchema(data), apiErrorResponseSchema]);
}

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ResponseMeta = z.infer<typeof responseMetaSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/**
 * Basari kolunun tipi.
 *
 * Bu tip ELLE yazilmistir cunku jenerik bir zarf tek bir Zod semasindan
 * turetilemez: sema bir fabrika oldugu icin z.infer'in baglanacagi sabit bir
 * sema nesnesi yoktur. Tipin fabrikanin urettigi sekille ayni kaldigi
 * test/unit/envelope.spec.ts icinde derleme zamaninda dogrulanir; ikisi
 * ayrisirsa test dosyasi derlenmez.
 */
export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  meta?: ResponseMeta | undefined;
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** Basarili zarf uretir. */
export function apiOk<T>(data: T, meta?: ResponseMeta): ApiSuccessResponse<T> {
  // meta undefined iken alani hic koymuyoruz: exactOptionalPropertyTypes acik
  // oldugu icin "meta: undefined" ile "meta yok" ayni sey degildir.
  return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

/** Hatali zarf uretir. */
export function apiFail(error: ApiError): ApiErrorResponse {
  return { success: false, error };
}
