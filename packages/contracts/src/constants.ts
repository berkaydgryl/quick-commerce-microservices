/**
 * Sozlesme sabitleri.
 *
 * Buradaki degerler REST ve socket yuzeyinin bir parcasidir: uzunluk sinirlari,
 * sayfa boyutu esikleri ve bicim desenleri. Tek kaynak burasidir ve
 * docs/api/openapi.yaml ile birebir ayni olmak zorundadir.
 *
 * NEDEN @getir/core'da DEGIL: core, protokolden bagimsiz cekirdek yapi
 * taslarini tutar (hata kodlari, siparis durumlari, Redis anahtarlari). Bir
 * sifrenin en fazla kac karakter olacagi ise HTTP yuzeyine ait bir karardir ve
 * yalnizca bu paketi ilgilendirir. Servisler arasi paylasilan is sabitleri
 * (ORDER_STATUS, SKU_PATTERN, ERROR_CODES) core'dan import edilir, burada
 * TEKRAR EDILMEZ.
 */

/** Telefon: E.164, yalnizca Turkiye (ADR-12). */
export const PHONE_PATTERN = /^\+90[0-9]{10}$/;

/** 3DS tek kullanimlik kodu: tam 6 rakam. */
export const OTP_PATTERN = /^[0-9]{6}$/;

/** Sifre uzunlugu. Ust sinir bcrypt'in 72 baytlik girdi sinirindan gelir. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

/** Ad soyad. */
export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 80;

/** Serbest metin urun aramasi. Tek karakterlik sorgu tum katalogu tarardi. */
export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 64;

/** Sepet sinirlari. */
export const CART_ITEM_MIN_QUANTITY = 1;
export const CART_ITEM_MAX_QUANTITY = 99;
export const CART_MIN_ITEMS = 1;
export const CART_MAX_ITEMS = 50;

/** Adres metinleri. */
export const ADDRESS_LINE_MAX_LENGTH = 240;
export const ADDRESS_NOTE_MAX_LENGTH = 240;

/** Idempotency anahtari (ADR-08). */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/**
 * Sayfalama.
 *
 * Sinir disi pageSize REDDEDILMEZ, ust sinira KIRPILIR. Gerekce: ayni davranis
 * gRPC tarafinda da gecerli (getir.common.v1.PageRequest) ve istemciye
 * "101 yerine 100 iste" demek yerine sessizce dogru olani vermek, sonsuz
 * kaydirma yapan bir arayuzde gereksiz hata ekrani uretmez.
 */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MIN = 1;
export const PAGE_SIZE_MAX = 100;

/** Socket oda adi onekleri (docs/api/socket-events.md). */
export const ROOM_PREFIX = {
  /** Yalnizca siparis sahibi girebilir; oda jetonu sarttir. */
  order: 'order:',
  /** Herkese acik; yalnizca stock.changed tasir. */
  store: 'store:',
} as const;

/**
 * Katalog kimliklerinin onekleri (ADR-15).
 *
 * Katalog kimlikleri seed ile gelir ve OKUNABILIRDIR: "mkt_migros-jet-moda",
 * "prd_sut-1l". Calisma aninda uretilen kimlikler (siparis, kullanici) ise
 * @getir/core ID_PREFIX + 32 onaltilik karakterdir; ikisi farkli kaynaktir ve
 * farkli dogrulanir.
 */
export const CATALOG_ID_PREFIX = {
  MARKET: 'mkt',
  PRODUCT: 'prd',
  CATEGORY: 'cat',
  OFFER: 'ofr',
} as const;

/** Onekten sonraki govde: kucuk harf, rakam ve tekli tire ("migros-jet-moda"). */
export const CATALOG_ID_BODY_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** Katalog kimliginin en uzun hali; yol parametresi olarak URL'de tasinir. */
export const CATALOG_ID_MAX_LENGTH = 64;

/** Market puani araligi (sabit seed verisi; yorum sistemi kapsam disi). */
export const RATING_MIN = 0;
export const RATING_MAX = 5;
