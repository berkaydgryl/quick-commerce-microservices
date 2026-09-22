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

import { MIN_SEARCH_QUERY_LENGTH } from '../../config/constants.js';

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

export const listProductsRequestSchema = z.object({
  categoryId: optionalText,
  darkStoreId: optionalText,
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
});

export type ListProductsRequestInput = z.infer<typeof listProductsRequestSchema>;
