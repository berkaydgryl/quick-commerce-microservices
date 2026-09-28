/**
 * Ortak ilkel semalar: para, konum, sayfalama ve tekrar eden metin bicimleri.
 *
 * Bu dosyadaki her sema, getir.common.v1 icindeki proto karsiliginin AYNI
 * anlamini tasir. Gateway ikisi arasinda alan adini camelCase'e cevirmekten
 * baska bir donusum yapmaz; bu yuzden alan adlari bilerek birebir tutulmustur
 * (amount_minor -> amountMinor, next_page_token -> nextPageToken).
 */

import { CURRENCY, ID_PREFIX } from '@getir/core';
import { z } from 'zod';

import {
  CATALOG_ID_BODY_PATTERN,
  CATALOG_ID_MAX_LENGTH,
  CATALOG_ID_PREFIX,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  LATITUDE_MAX,
  LATITUDE_MIN,
  LONGITUDE_MAX,
  LONGITUDE_MIN,
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
  currency: z.literal(CURRENCY),
});

/** Eksik alan ve tip hatasi mesajlari; gateway'in bicim hatalariyla ayni sozcukler (params.go). */
const REQUIRED_MESSAGE = 'zorunlu';
const NOT_A_NUMBER_MESSAGE = 'sayi olmali';

/**
 * Sorgu dizesinden gelen sayi. Gateway'in bicim kuraliyla ayni: eksik ya da
 * bos parametre "zorunlu" (coerce bos metni sessizce 0 yapardi - konum icin
 * Gine Korfezi), sayi olmayan metin "sayi olmali". Aralik kurali pipe ile
 * arkasina eklenir.
 */
export function queryNumberSchema() {
  return z
    .string({ required_error: REQUIRED_MESSAGE })
    .trim()
    .min(1, REQUIRED_MESSAGE)
    .pipe(z.coerce.number({ invalid_type_error: NOT_A_NUMBER_MESSAGE }));
}

/**
 * Tek koordinat: sonlu sayi, WGS84 araliginda.
 *
 * MESAJLAR TURKCE (D6): servisin dogrulama hatasi gateway'den REST zarfinin
 * `details` alanina AYNEN gecer. Zod'un varsayilan Ingilizce mesaji ("Number
 * must be less than or equal to 90") boylece istemciye kadar siziyordu.
 */
function coordinateSchema(label: string, min: number, max: number) {
  const outOfRange = `${label} ${min} ile ${max} arasinda olmali`;
  return z
    .number({ required_error: REQUIRED_MESSAGE, invalid_type_error: NOT_A_NUMBER_MESSAGE })
    .finite(outOfRange)
    .min(min, outOfRange)
    .max(max, outOfRange);
}

export const latitudeSchema = coordinateSchema('enlem', LATITUDE_MIN, LATITUDE_MAX);
export const longitudeSchema = coordinateSchema('boylam', LONGITUDE_MIN, LONGITUDE_MAX);

/**
 * WGS84 koordinat cifti. Alan adlari proto ve socket ile ayni: lat/lng.
 * Konumun kendisi eksikse de mesaj Turkcedir: proto3'te set edilmemis mesaj
 * alani undefined gelir ve (0, 0) - Gine Korfezi - gibi islenmemelidir.
 */
export const geoPointSchema = z.object(
  { lat: latitudeSchema, lng: longitudeSchema },
  { required_error: REQUIRED_MESSAGE },
);

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

/**
 * Idempotency anahtari (ADR-08): bosluk kirpilir, uzunluk sinirlari core'dan.
 * payment'in gRPC semalari ve payment.refund_requested olayi bunu kullanir
 * (T7.4); order'in gRPC semasindaki kopya D5'te buraya baglanir.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(IDEMPOTENCY_KEY_MIN_LENGTH, `en az ${IDEMPOTENCY_KEY_MIN_LENGTH} karakter olmali`)
  .max(IDEMPOTENCY_KEY_MAX_LENGTH, `en fazla ${IDEMPOTENCY_KEY_MAX_LENGTH} karakter olmali`);

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
