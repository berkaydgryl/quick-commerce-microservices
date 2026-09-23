/**
 * Ortak ilkel semalar: para, konum, sayfalama ve tekrar eden metin bicimleri.
 *
 * Bu dosyadaki her sema, getir.common.v1 icindeki proto karsiliginin AYNI
 * anlamini tasir. Gateway ikisi arasinda alan adini camelCase'e cevirmekten
 * baska bir donusum yapmaz; bu yuzden alan adlari bilerek birebir tutulmustur
 * (amount_minor -> amountMinor, next_page_token -> nextPageToken).
 */

import { ID_PREFIX } from '@getir/core';
import { z } from 'zod';

import {
  CATALOG_ID_BODY_PATTERN,
  CATALOG_ID_MAX_LENGTH,
  CATALOG_ID_PREFIX,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PAGE_SIZE_MIN,
} from './constants.js';

/**
 * Calisma aninda uretilen kimlik: @getir/core ID_PREFIX + "_" + 32 onaltilik
 * karakter ("ord_db77f4c0e24f49919cc1d78a649c9c94").
 *
 * DUZELTME (ADR-15): ilk surum UUID bekliyordu; oysa sistemin urettigi hicbir
 * kimlik UUID degildi - siparis kimlikleri bu semadan gecemezdi. Onek sozlugu
 * core'dan okunur, burada tekrar yazilmaz.
 */
export const idSchema = z
  .string()
  .regex(new RegExp(`^(?:${Object.values(ID_PREFIX).join('|')})_[0-9a-f]{32}$`), {
    message: 'gecersiz kimlik bicimi',
  });

/**
 * Katalog kimligi semasi uretir: "<onek>_<okunabilir-govde>" (ADR-15).
 * Seed ile gelen kimlikler icindir; UUID ya da 32 hex DEGILDIR.
 */
function catalogIdSchema(prefix: string) {
  return z
    .string()
    .max(CATALOG_ID_MAX_LENGTH)
    .regex(new RegExp(`^${prefix}_${CATALOG_ID_BODY_PATTERN}$`), {
      message: `${prefix}_ onekli kimlik bekleniyor`,
    });
}

export const marketIdSchema = catalogIdSchema(CATALOG_ID_PREFIX.MARKET);
export const productIdSchema = catalogIdSchema(CATALOG_ID_PREFIX.PRODUCT);
export const categoryIdSchema = catalogIdSchema(CATALOG_ID_PREFIX.CATEGORY);
export const offerIdSchema = catalogIdSchema(CATALOG_ID_PREFIX.OFFER);

/**
 * ISO 8601 UTC zaman damgasi.
 *
 * Metin olarak tasinir, Date nesnesine CEVRILMEZ: zarf JSON uzerinden gecer ve
 * JSON'da Date diye bir tip yoktur. Cevirme sorumlulugu gosterim katmanindadir.
 */
export const isoDateTimeSchema = z.string().datetime();

/**
 * Para tutari.
 *
 * KURUS cinsinden TAM SAYI. Float yasak: ikili kayan nokta 0,1 + 0,2 gibi
 * toplamlarda yuvarlama hatasi uretir ve sepet toplami ile odenen tutar tutmaz.
 * 100'e bolme yalnizca gosterim aninda, istemcide yapilir.
 */
export const moneySchema = z.object({
  amountMinor: z.number().int().min(0),
  currency: z.literal('TRY'),
});

/** WGS84 koordinat cifti. Alan adlari proto ve socket ile ayni: lat/lng. */
export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * Sayfalama ust verisi (liste cevaplarinda items ile birlikte doner).
 *
 * IMLEC tabanlidir, sayfa numarasi yoktur: katalog siralamasi stok ve kampanya
 * ile surekli degistigi icin offset kayar, ayni urun iki sayfada gorunur ya da
 * hic gorunmez.
 */
export const pageSchema = z.object({
  /** Bos ise liste bitmistir. Dongu kayit sayisina gore DEGIL buna gore biter. */
  nextPageToken: z.string(),
  /** 0 degeri "sonuc yok" DEGIL, "sayilmadi" demektir. */
  totalSize: z.number().int().min(0),
});

/**
 * Liste uclarinin ortak sorgu parametreleri.
 *
 * pageSize sinir disi geldiginde REDDEDILMEZ, kirpilir. Bu yuzden sema
 * min/max ile dogrulamak yerine transform ile duzeltir; girdi sorgu dizesinden
 * geldigi icin coerce kullanilir.
 */
export const pageQuerySchema = z.object({
  pageToken: z.string().optional(),
  pageSize: z.coerce
    .number()
    .int()
    .default(PAGE_SIZE_DEFAULT)
    .transform((value) => Math.min(Math.max(value, PAGE_SIZE_MIN), PAGE_SIZE_MAX)),
});

export type Id = z.infer<typeof idSchema>;
export type MarketId = z.infer<typeof marketIdSchema>;
export type ProductId = z.infer<typeof productIdSchema>;
export type CategoryId = z.infer<typeof categoryIdSchema>;
export type OfferId = z.infer<typeof offerIdSchema>;
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
export type Money = z.infer<typeof moneySchema>;
export type GeoPoint = z.infer<typeof geoPointSchema>;
export type Page = z.infer<typeof pageSchema>;
export type PageQuery = z.infer<typeof pageQuerySchema>;
