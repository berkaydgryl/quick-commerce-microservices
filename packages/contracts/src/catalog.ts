/**
 * Katalog ve karanlik magaza uclarinin semalari.
 *
 * DIKKAT - BURADAKI Product PROTO'DAKI Product DEGILDIR. Ikisi bilerek
 * farklidir:
 *   - getir.catalog.v1.Product  -> stok alani YOKTUR (B27)
 *   - buradaki productSchema    -> availableQuantity ZORUNLUDUR
 * Sebep: katalog verisi catalog-svc'den, adet ise inventory-svc'den gelir ve
 * gateway ikisini BIRLESTIREREK istemciye tek gorunum sunar. Istemcinin iki
 * ayri cagri yapip elde birlestirmesi istenmiyor.
 */

import { SKU_PATTERN } from '@getir/core';
import { z } from 'zod';

import { geoPointSchema, idSchema, moneySchema, pageQuerySchema, pageSchema } from './common.js';
import { SEARCH_QUERY_MAX_LENGTH, SEARCH_QUERY_MIN_LENGTH } from './constants.js';

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
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  imageUrl: z.string().url().optional(),
  sortOrder: z.number().int().optional(),
});

export const productSchema = z.object({
  id: z.string(),
  sku: skuSchema,
  name: z.string(),
  description: z.string().optional(),
  categoryId: z.string(),
  imageUrl: z.string().url().optional(),
  /**
   * Liste fiyati: kampanya UYGULANMAMIS halidir ve magazadan BAGIMSIZDIR.
   * Indirim hesabi sepet duzeyinde yapilir, urun duzeyinde degil.
   */
  price: moneySchema,
  unit: unitSchema.optional(),
  /**
   * darkStoreId kapsaminda satilabilir adet. Kaynagi inventory-svc'dir ve
   * TOPLU sorgulanir (CheckAvailability(darkStoreId, sku[]), B27).
   */
  availableQuantity: z.number().int().min(0),
});

/**
 * Urun listesi sorgusu.
 *
 * darkStoreId ZORUNLUDUR cunku stok magaza kapsamlidir; magaza bilinmeden
 * availableQuantity doldurulamaz. Fiyat ise magazadan bagimsizdir.
 */
export const listProductsQuerySchema = pageQuerySchema.extend({
  darkStoreId: idSchema,
  categoryId: idSchema.optional(),
  /** Tek karakterlik sorgu tum katalogu tarardi; en az iki karakter. */
  q: z.string().min(SEARCH_QUERY_MIN_LENGTH).max(SEARCH_QUERY_MAX_LENGTH).optional(),
});

export const categoryListSchema = z.object({
  items: z.array(categorySchema),
});

export const productPageSchema = z.object({
  items: z.array(productSchema),
  page: pageSchema,
});

export const resolveDarkStoreRequestSchema = z.object({
  location: geoPointSchema,
});

/**
 * Karanlik magaza.
 *
 * Minimum sepet ve teslimat ucreti BU SEMADA TUTULMAZ; degerler pricing
 * sabitlerinden gelir ve tek kaynak orasidir. Magaza basina farklilastirma bu
 * fazda kapsam disidir.
 */
export const darkStoreSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: geoPointSchema,
  /** Yaricap disindaki konum NO_STORE alir. */
  deliveryRadiusMeters: z.number().int().positive().optional(),
  /**
   * Kapali magaza da NO_STORE ile sonuclanir; sebep hata govdesindeki
   * details.reason = "STORE_CLOSED" alaninda tasinir. Iki ayri hata kodu
   * olsaydi istemcide iki ayri ekran gerekirdi, oysa kullanici acisindan
   * sonuc aynidir: siparis verilemez.
   */
  isOpen: z.boolean().optional(),
});

export const darkStoreMatchSchema = z.object({
  darkStore: darkStoreSchema,
  distanceMeters: z.number().int().min(0),
  /** COURIER_SPEED_KMH uzerinden hesaplanan tahmin. */
  etaMinutes: z.number().int().min(0),
});

export type Sku = z.infer<typeof skuSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Product = z.infer<typeof productSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type CategoryList = z.infer<typeof categoryListSchema>;
export type ProductPage = z.infer<typeof productPageSchema>;
export type ResolveDarkStoreRequest = z.infer<typeof resolveDarkStoreRequestSchema>;
export type DarkStore = z.infer<typeof darkStoreSchema>;
export type DarkStoreMatch = z.infer<typeof darkStoreMatchSchema>;
