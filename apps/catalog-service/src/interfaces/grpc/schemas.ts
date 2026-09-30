/**
 * gRPC istek semalari (Zod).
 *
 * NEDEN PROTO YETMIYOR: proto3 bicimi dogrular (alan tipi), KURALI dogrulamaz.
 * "Sorgu en az 2 karakter", "sayfa boyutu pozitif" gibi kurallar sozlesmede
 * yaziyla anlatilmis; burada calisir hale geliyor (ADR-10: dogrulama tek
 * kutuphane, Zod).
 *
 * KURALLAR @getir/contracts'TAN GELIR (D6): gateway yalnizca bicimi dogrular
 * ("sayi mi?"), kuralin kendisi buradadir. Onceki surum REST sozlesmesinden
 * gevsekti: `categoryId=sut` 200 + bos liste, 65 karakterlik arama 200,
 * `/v1/markets/BAD!ID` 404 donuyordu. Artik kimlik bicimi, arama uzunlugu ve
 * konum araligi REST'in kullandigi AYNI semalardir; hepsi 400 doner.
 *
 * PROTO3 VARSAYILANI TUZAGI: proto3'te set edilmemis string alan tel uzerinde
 * yoktur ve cozuldugunde BOS METIN olur; yani "gonderilmedi" ile "bos gonderildi"
 * ayirt edilemez. Katalog icin bos filtre = "filtreleme" demektir, bu yuzden
 * bos metinler burada undefined'a cevrilir ve use-case yalnizca gercek
 * filtreleri gorur.
 */

import {
  categoryIdSchema,
  geoPointSchema,
  marketIdSchema,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
} from '@getir/contracts';
import { z } from 'zod';

import type { ListProductsInput } from '../../application/list-products.js';
import { MAX_BATCH_OFFER_IDS } from '../../config/constants.js';

/** Bos metni "yok" sayan istege bagli alan. */
const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    const text = value?.trim() ?? '';
    return text === '' ? undefined : text;
  });

/** ListCategories parametresizdir; sema yine de calisir (ileride alan eklenirse kapi hazir). */
export const listCategoriesRequestSchema = z.object({});

/** Bos olamayan metin (proto3'te eksik alan "" gelir). */
const requiredText = z.string({ required_error: 'zorunlu' }).trim().min(1, 'zorunlu');

/**
 * Zorunlu katalog kimligi: bossa "zorunlu", doluysa sozlesmenin bicimi
 * (onek + okunabilir govde, en fazla 64 karakter). Bos deger bicim hatasi
 * gibi raporlanmasin diye ilk kontrol ayridir; pipe ilk hatada durur.
 */
const requiredCatalogId = (contract: z.ZodString) => requiredText.pipe(contract);

/** Istege bagli katalog kimligi: bos = filtre yok, doluysa sozlesmenin bicimi. */
const optionalCatalogId = (contract: z.ZodString) => optionalText.pipe(contract.optional());

/** Serbest metin aramasi: bos = arama yok, doluysa REST'teki uzunluk siniri. */
const searchQuery = optionalText.pipe(
  z
    .string()
    .min(SEARCH_QUERY_MIN_LENGTH, `en az ${SEARCH_QUERY_MIN_LENGTH} karakter olmali`)
    .max(SEARCH_QUERY_MAX_LENGTH, `en fazla ${SEARCH_QUERY_MAX_LENGTH} karakter olmali`)
    .optional(),
);

/**
 * ListProducts: market ZORUNLU (ADR-15). dark_store_id deprecated alan olarak
 * telde gelebilir; sema onu okumaz, yok sayar.
 *
 * Cikti dogrudan use-case girdisidir (ListProductsInput): telin duz bicimini
 * use-case'in `filter` + sayfa bicimine cevirmek de "istegi dogrula" isinin
 * parcasi. Handler boylece yalnizca cagirir ve cevirir (~15 satir kurali).
 * Bos filtreler anahtar olarak HIC yazilmaz (exactOptionalPropertyTypes:
 * `categoryId: undefined` ile "anahtar yok" ayri tiplerdir).
 */
export const listProductsRequestSchema = z
  .object({
    marketId: requiredCatalogId(marketIdSchema),
    categoryId: optionalCatalogId(categoryIdSchema),
    query: searchQuery,
    page: z
      .object({
        // Sinirlari BURADA degil domain'de uyguluyoruz: sozlesme "reddetme,
        // kirp" diyor; sema reddederse o kural cignenir.
        pageSize: z.number().int().optional(),
        pageToken: z.string().optional(),
      })
      .optional(),
  })
  .transform(({ marketId, categoryId, query, page }): ListProductsInput => ({
    filter: {
      marketId,
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(query === undefined ? {} : { query }),
    },
    pageSize: page?.pageSize,
    pageToken: page?.pageToken,
  }));

/**
 * ListNearbyMarkets. Konum ZORUNLUDUR: proto3'te mesaj alani set edilmezse
 * undefined gelir ve "konum yok" sessizce (0, 0) - Gine Korfezi - gibi
 * islenmemeli. WGS84 araligi ve Turkce mesajlari sozlesme paketindedir.
 */
export const listNearbyMarketsRequestSchema = z.object({ location: geoPointSchema });

/**
 * SearchNearby (T9.6): konum ListNearbyMarkets'teki gibi ZORUNLU; sorgu da
 * ZORUNLU ve ListProducts aramasiyla ayni uzunluk kurallarinda (kirpildiktan
 * sonra 2-64). Bos sorgu "zorunlu" olarak raporlanir, uzunluk hatasi olarak degil.
 */
export const searchNearbyRequestSchema = z.object({
  location: geoPointSchema,
  query: requiredText.pipe(
    z
      .string()
      .min(SEARCH_QUERY_MIN_LENGTH, `en az ${SEARCH_QUERY_MIN_LENGTH} karakter olmali`)
      .max(SEARCH_QUERY_MAX_LENGTH, `en fazla ${SEARCH_QUERY_MAX_LENGTH} karakter olmali`),
  ),
});

export const getMarketRequestSchema = z.object({ marketId: requiredCatalogId(marketIdSchema) });

export const listMarketCategoriesRequestSchema = z.object({
  marketId: requiredCatalogId(marketIdSchema),
});

/**
 * BatchGetOffers (T9.3). Market kimligi sozlesme bicimindedir. En fazla
 * MAX_BATCH_OFFER_IDS urun kimligi; bos kimlik reddedilir. URUN KIMLIGI
 * BILEREK ESNEK: bicimi bozuk ama dolu kimlik REDDEDILMEZ, o kimlikle teklif
 * yoktur ve `missing`'de doner - toplu okumada tek hatali kalem butun sepeti
 * dusurmemeli. Bos liste gecerlidir (bos cevap).
 */
export const batchGetOffersRequestSchema = z.object({
  marketId: requiredCatalogId(marketIdSchema),
  productIds: z
    .array(requiredText)
    .max(MAX_BATCH_OFFER_IDS, `en fazla ${MAX_BATCH_OFFER_IDS} urun kimligi`),
});
