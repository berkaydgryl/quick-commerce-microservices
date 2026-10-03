/**
 * Pazaryeri katalog uclarinin semalari: market, kategori, urun (ADR-15).
 *
 * Is modeli pazaryeridir: kullanici konumuna hizmet veren marketler arasindan
 * birini SECER; urun katalogu ortaktir, FIYAT markete ozeldir. Bu yuzden REST'te
 * urun her zaman bir market BAGLAMINDA doner (marketId + o marketin fiyati).
 *
 * DIKKAT - BURADAKI Product PROTO'DAKI Product DEGILDIR. Ikisi bilerek
 * farklidir:
 *   - getir.catalog.v1.Offer   -> urun + o marketteki fiyat, stok YOK (B27)
 *   - buradaki productSchema   -> teklif + availableQuantity (stok bilgisi varsa)
 * Sebep: fiyat catalog-svc'den (Offer), adet inventory-svc'den gelir ve gateway
 * ikisini BIRLESTIREREK istemciye tek gorunum sunar.
 */

import { SKU_PATTERN } from '@getir/core';
import { z } from 'zod';

import {
  categoryIdSchema,
  geoPointSchema,
  latitudeSchema,
  longitudeSchema,
  marketIdSchema,
  moneySchema,
  offerIdSchema,
  pageQuerySchema,
  pageSchema,
  productIdSchema,
  queryNumberSchema,
} from './common.js';
import {
  RATING_MAX,
  RATING_MIN,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_RESULT_PRODUCTS_MAX,
} from './constants.js';

/**
 * Stok tutma birimi.
 *
 * Bicim kurali @getir/core icindeki SKU_PATTERN'dendir; burada tekrar
 * yazilmaz. sku servisler arasi birlestirme anahtaridir: katalog urununu,
 * Redis stok sayacini ve stock_ledger kaydini ayni degerle baglar.
 */
export const skuSchema = z.string().regex(SKU_PATTERN);

/** getir.common.v1.Unit ile birebir ayni sozluk. */
export const unitSchema = z.enum(['PIECE', 'KILOGRAM', 'LITER', 'PACK']);

/** Kategoriler DUZ listedir; agac yoktur. Siralama sortOrder iledir. */
export const categorySchema = z.object({
  id: categoryIdSchema,
  name: z.string(),
  slug: z.string(),
  /** Mutlak URL; veri goreli yol saklar, gateway ASSET_BASE_URL ile kurar. */
  imageUrl: z.string().url().optional(),
  sortOrder: z.number().int().optional(),
});

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

/**
 * Marketin sepet kurallari. Market paneli olmadigi icin bugun seed'den gelir
 * (ADR-15); pricing bu degerleri PARAMETRE olarak alir.
 */
export const pricingRulesSchema = z.object({
  /** Bunun altindaki sepet siparise donusmez. */
  minBasket: moneySchema,
  /** Esik altindaki sepete eklenen teslimat ucreti. */
  deliveryFee: moneySchema,
  /** Ara toplam (indirim ONCESI, B12) bu tutara ulasirsa teslimat ucretsizdir. */
  freeDeliveryThreshold: moneySchema,
});

/** Tahmini teslimat suresi araligi, dakika ("15-25 dk"). */
export const deliveryTimeSchema = z
  .object({
    minMinutes: z.number().int().min(0),
    maxMinutes: z.number().int().min(0),
  })
  .refine((range) => range.minMinutes <= range.maxMinutes, {
    message: 'minMinutes, maxMinutes degerinden buyuk olamaz',
    path: ['minMinutes'],
  });

/**
 * Market puani. Proto onda bir hassasiyetle tam sayi tasir (47); gateway REST'e
 * 4.7 olarak cevirir. Puanlar seed'de sabittir; yorum sistemi kapsam disidir.
 */
export const ratingSchema = z.object({
  average: z.number().min(RATING_MIN).max(RATING_MAX),
  count: z.number().int().min(0),
});

/**
 * Dukkan turu (T11.11): market listesinin sol menusu bu alana gore suzer.
 * Proto StoreType ile ayni sira; yeni tur sona eklenir.
 */
export const storeTypeSchema = z.enum([
  'MARKET',
  'MANAV',
  'KASAP',
  'SARKUTERI',
  'KURUYEMIS',
  'FIRIN',
  'PETSHOP',
  'CICEKCI',
]);

export const marketSchema = z.object({
  id: marketIdSchema,
  /** Gorunen ad: "Migros Jet - Moda". */
  name: z.string(),
  /** Marka: "Migros Jet". */
  brand: z.string(),
  /** Mutlak URL (gateway kurar); logosu olmayan market icin alan yok. */
  logoUrl: z.string().url().optional(),
  /** Tur bilinmiyorsa alan yok (eski catalog-service); listede yalnizca "Tumu" altinda gorunur. */
  storeType: storeTypeSchema.optional(),
  /** Kapak gorseli, mutlak URL (gateway kurar); kapagi olmayan market icin alan yok. */
  coverUrl: z.string().url().optional(),
  location: geoPointSchema,
  deliveryRadiusMeters: z.number().int().positive(),
  /** Kapali market listede gorunur ("Kapali" rozeti) ama siparis almaz. */
  isOpen: z.boolean(),
  deliveryTime: deliveryTimeSchema,
  rating: ratingSchema,
  pricingRules: pricingRulesSchema,
});

/** Yakindaki market: konuma uzakligiyla. */
export const nearbyMarketSchema = z.object({
  market: marketSchema,
  /** Metre; her zaman market.deliveryRadiusMeters'tan kucuk veya esittir. */
  distanceMeters: z.number().int().min(0),
});

/**
 * GET /v1/markets?lat&lng. Sorgu dizesinden geldigi icin coerce kullanilir;
 * aralik kurali ve mesaji govdedeki konumla AYNI semadan gelir.
 * Konum ZORUNLUDUR: eksik konum (0,0) gibi islenmemeli.
 */
export const nearbyMarketsQuerySchema = z.object({
  lat: queryNumberSchema().pipe(latitudeSchema),
  lng: queryNumberSchema().pipe(longitudeSchema),
});

/** Yakindan uzaga. Bos liste = "bolgende market yok" (hata degil). */
export const nearbyMarketListSchema = z.object({
  items: z.array(nearbyMarketSchema),
});

// ---------------------------------------------------------------------------
// Urun (bir marketin teklifi olarak)
// ---------------------------------------------------------------------------

export const productSchema = z.object({
  /** Ortak urun kimligi: ayni urun farkli marketlerde ayni id'yi tasir. */
  id: productIdSchema,
  /** Bu marketin bu urunu satisi; fiyatin sahibi. */
  offerId: offerIdSchema,
  marketId: marketIdSchema,
  sku: skuSchema,
  name: z.string(),
  description: z.string().optional(),
  categoryId: categoryIdSchema,
  imageUrl: z.string().url().optional(),
  /**
   * Bu MARKETTEKI liste fiyati (ADR-15): ayni urun baska markette farkli
   * fiyattadir. Kampanya UYGULANMAMIS halidir; indirim sepet duzeyindedir.
   */
  price: moneySchema,
  unit: unitSchema.optional(),
  /**
   * Teklif SATISTA MI (proto Offer.is_active). false: market urunu satistan
   * kaldirmistir; kayit silinmez ki gecmis siparisler bozulmasin. Liste pasif
   * teklifi de dondurur (catalog tasarimi): istemci onu "Satista degil" diye
   * gosterir ve sepete EKLEMEZ (T7.6). Baglayici kontrol yine rezervasyondadir:
   * pasif teklif orada bulunamamis sayilir (T7.2).
   */
  isActive: z.boolean(),
  /**
   * marketId kapsaminda satilabilir adet. Kaynagi inventory-svc'dir ve
   * TOPLU sorgulanir (CheckAvailability(marketId, sku[]), B27).
   *
   * 0 "tukendi"dir. inventory-svc'de stok kaydi olmayan urun de 0 gelir
   * ("satilamaz"): rezervasyon da onu reddeder.
   *
   * ISTEGE BAGLIDIR: alan YOKSA "stok bilgisi yok" demektir, "stok 0" DEGIL.
   * Yalnizca inventory-svc cevap vermediginde (hata ya da gateway'in stok sure
   * siniri) yoktur: katalog stoksuz gorunumle ayakta kalir (T8.4). Istemci bu
   * durumda stok rozeti gostermez; baglayici kontrol rezervasyonda yapilir (ADR-13).
   */
  availableQuantity: z.number().int().min(0).optional(),
});

/**
 * GET /v1/markets/{marketId}/products. marketId YOL parametresidir; burada
 * yalnizca filtreler ve sayfalama vardir.
 */
export const marketProductsQuerySchema = pageQuerySchema.extend({
  categoryId: categoryIdSchema.optional(),
  /**
   * Arama: tek karakterlik sorgu tum katalogu tarardi; en az iki karakter.
   * Sunucu ad ve aciklamada, harf ve Turkce karakter duyarsiz arar ("sut" ->
   * "Süt"); bosluklu sorguda kelimelerin hepsi gecmeli, sira onemsiz (T9.4).
   */
  q: z.string().min(SEARCH_QUERY_MIN_LENGTH).max(SEARCH_QUERY_MAX_LENGTH).optional(),
});

export const categoryListSchema = z.object({
  items: z.array(categorySchema),
});

export const productPageSchema = z.object({
  items: z.array(productSchema),
  page: pageSchema,
});

// ---------------------------------------------------------------------------
// Genel arama (T9.6): markete girmeden, yakindaki marketlerde
// ---------------------------------------------------------------------------

/**
 * Genel aramanin arama metni: ZORUNLU. Bas ve son bosluk kirpilir; bos metin
 * "zorunlu", kirpilmis metin 2-64 karakter. REST sorgusu (searchQuerySchema)
 * ve catalog-service'in SearchNearby semasi AYNI kurali kullanir (D6).
 */
export const requiredSearchTextSchema = z
  .string({ required_error: 'zorunlu' })
  .trim()
  .min(1, 'zorunlu')
  .pipe(
    z
      .string()
      .min(SEARCH_QUERY_MIN_LENGTH, `en az ${SEARCH_QUERY_MIN_LENGTH} karakter olmali`)
      .max(SEARCH_QUERY_MAX_LENGTH, `en fazla ${SEARCH_QUERY_MAX_LENGTH} karakter olmali`),
  );

/**
 * GET /v1/search?lat&lng&q. Konum yakindaki marketlerle ayni kural (zorunlu,
 * WGS84); arama market ici aramayla ayni eslesme kuralinda (T9.4: harf ve
 * Turkce karakter duyarsiz, bosluklu sorguda her kelime) ama ZORUNLU.
 */
export const searchQuerySchema = nearbyMarketsQuerySchema.extend({
  q: requiredSearchTextSchema,
});

/**
 * Genel aramada bir market: yakindaki market satiri + arama bilgisi. market ve
 * products mevcut semalardir; istemci ayni market kartini ve urun satirini
 * kullanir.
 */
export const searchResultSchema = nearbyMarketSchema.extend({
  /**
   * Market adi sorguyla eslesti ("Market ya da Urun ara"). Eslestiyse market,
   * urun eslesmesi olmasa da listelenir; o zaman products bostur.
   */
  marketNameMatched: z.boolean(),
  /**
   * Eslesen urunlerin ilkleri, market sayfasiyla ayni sirada. Yalnizca AKTIF
   * teklifler: satistan kaldirilmis urun genel aramada yoktur. Stok market
   * sayfasindaki kuralla gelir (availableQuantity, T8.4).
   */
  products: z.array(productSchema).max(SEARCH_RESULT_PRODUCTS_MAX),
  /**
   * Bu marketteki toplam eslesen urun. products'tan fazlaysa istemci
   * "+N urun daha" gosterir ve market sayfasini ayni aramayla acar.
   */
  totalProductMatches: z.number().int().min(0),
});

/**
 * GET /v1/search cevabi. SIRA MESAFEDIR (fiyat degil: farkli urunlerde gramaj
 * farki yaniltir): acik marketler yakindan uzaga, kapali marketler en sonda.
 * Sayfasiz SINIRLI liste: en fazla 20 market, market basina en fazla 3 urun
 * (proje kurallari, "Sinirli listeler istisnasi"). Bos liste = eslesme yok ya
 * da bolgede market yok; hata degil.
 */
export const searchResultListSchema = z.object({
  items: z.array(searchResultSchema),
});

export type Sku = z.infer<typeof skuSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type Category = z.infer<typeof categorySchema>;
export type PricingRules = z.infer<typeof pricingRulesSchema>;
export type DeliveryTime = z.infer<typeof deliveryTimeSchema>;
export type Rating = z.infer<typeof ratingSchema>;
export type StoreType = z.infer<typeof storeTypeSchema>;
export type Market = z.infer<typeof marketSchema>;
export type NearbyMarket = z.infer<typeof nearbyMarketSchema>;
export type NearbyMarketsQuery = z.infer<typeof nearbyMarketsQuerySchema>;
export type NearbyMarketList = z.infer<typeof nearbyMarketListSchema>;
export type Product = z.infer<typeof productSchema>;
export type MarketProductsQuery = z.infer<typeof marketProductsQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchResultList = z.infer<typeof searchResultListSchema>;
export type CategoryList = z.infer<typeof categoryListSchema>;
export type ProductPage = z.infer<typeof productPageSchema>;
