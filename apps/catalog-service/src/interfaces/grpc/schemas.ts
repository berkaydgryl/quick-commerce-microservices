/**
 * gRPC istek semalari (Zod).
 *
 * NEDEN PROTO YETMIYOR: proto3 bicimi dogrular (alan tipi), KURALI dogrulamaz.
 * "Sorgu en az 2 karakter", "sayfa boyutu pozitif" gibi kurallar sozlesmede
 * yaziyla anlatilmis; burada calisir hale geliyor (ADR-10: dogrulama tek
 * kutuphane, Zod).
 *
 * PROTO3 VARSAYILANI TUZAGI: proto3'te set edilmemis string alan tel uzerinde
 * yoktur ve cozuldugunde BOS METIN olur; yani "gonderilmedi" ile "bos gonderildi"
 * ayirt edilemez. Katalog icin bos filtre = "filtreleme" demektir, bu yuzden
 * bos metinler burada undefined'a cevrilir ve use-case yalnizca gercek
 * filtreleri gorur.
 */

import { z } from 'zod';

import type { ListProductsInput } from '../../application/list-products.js';
import { MAX_BATCH_OFFER_IDS, MIN_SEARCH_QUERY_LENGTH } from '../../config/constants.js';

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

/** Bos olamayan kimlik metni (proto3'te eksik alan "" gelir). */
const requiredId = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value !== '', { message: 'zorunlu' });

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
    marketId: requiredId,
    categoryId: optionalText,
    query: optionalText.refine(
      (value) => value === undefined || value.length >= MIN_SEARCH_QUERY_LENGTH,
      { message: `en az ${MIN_SEARCH_QUERY_LENGTH} karakter olmali` },
    ),
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
 * islenmemeli. Alt alanlardaki sinirlar WGS84 araligidir.
 */
export const listNearbyMarketsRequestSchema = z.object({
  location: z.object(
    {
      lat: z.number().finite().min(-90).max(90),
      lng: z.number().finite().min(-180).max(180),
    },
    { required_error: 'zorunlu' },
  ),
});

export const getMarketRequestSchema = z.object({ marketId: requiredId });

export const listMarketCategoriesRequestSchema = z.object({ marketId: requiredId });

/**
 * BatchGetOffers (T9.3). En fazla MAX_BATCH_OFFER_IDS kimlik (sozlesme);
 * bos kimlik reddedilir. Bicimi bozuk ama dolu kimlik REDDEDILMEZ: o kimlikle
 * teklif yoktur ve `missing`'de doner - toplu okumada tek hatali kalem butun
 * sepeti dusurmemeli. Bos liste gecerlidir (bos cevap).
 */
export const batchGetOffersRequestSchema = z.object({
  marketId: requiredId,
  productIds: z
    .array(requiredId)
    .max(MAX_BATCH_OFFER_IDS, `en fazla ${MAX_BATCH_OFFER_IDS} urun kimligi`),
});
