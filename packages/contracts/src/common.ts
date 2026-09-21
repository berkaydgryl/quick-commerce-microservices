/**
 * Ortak ilkel semalar: para, konum, sayfalama ve tekrar eden metin bicimleri.
 *
 * Bu dosyadaki her sema, getir.common.v1 icindeki proto karsiliginin AYNI
 * anlamini tasir. Gateway ikisi arasinda alan adini camelCase'e cevirmekten
 * baska bir donusum yapmaz; bu yuzden alan adlari bilerek birebir tutulmustur
 * (amount_minor -> amountMinor, next_page_token -> nextPageToken).
 */

import { z } from 'zod';

import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, PAGE_SIZE_MIN } from './constants.js';

/** UUID v4 kimlik. */
export const idSchema = z.string().uuid();

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
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
export type Money = z.infer<typeof moneySchema>;
export type GeoPoint = z.infer<typeof geoPointSchema>;
export type Page = z.infer<typeof pageSchema>;
export type PageQuery = z.infer<typeof pageQuerySchema>;
