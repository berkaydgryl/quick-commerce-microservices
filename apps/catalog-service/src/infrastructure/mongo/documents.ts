/**
 * Katalog koleksiyonlarinin Mongo'daki SEKLI.
 *
 * Domain tipinden ayri tutulur: belge, sorguyu hizlandirmak icin domain'de
 * olmayan alanlar tasir (darkStoreIds, searchTerms) ve konumu GeoJSON olarak
 * saklar. Ceviri tek yerdedir: mappers.ts.
 */

import type { BaseDocument } from '@getir/mongo-kit';

import type { ProductUnit } from '../../domain/catalog.js';

/** Koleksiyon adlari - roadmap "MongoDB Veri Modeli" tablosuyla ayni. */
export const COLLECTIONS = {
  CATEGORIES: 'categories',
  PRODUCTS: 'products',
  DARK_STORES: 'darkstores',
} as const;

export interface CategoryDocument extends BaseDocument {
  name: string;
  slug: string;
  sortOrder: number;
  /** GORELI yol; mutlak URL'yi gateway kurar. */
  imageUrl: string;
}

export interface ProductDocument extends BaseDocument {
  sku: string;
  name: string;
  description: string;
  /** Kurus cinsinden tam sayi. */
  priceMinor: number;
  categoryId: string;
  unit: ProductUnit;
  imageUrl: string;
  isActive: boolean;
  /**
   * Bu urunu SATAN depolar (cesit bilgisi, stok degil - B27). Depo filtresi
   * { darkStoreIds: id } ile tek sorguda cozulur; ayri bir "assortment"
   * koleksiyonu ikinci bir okuma ve birlestirme demekti.
   */
  darkStoreIds: string[];
  /**
   * Arama icin normalize edilmis ad ve aciklama (domain/searchKey).
   * Yazim aninda uretilir, cunku Mongo'nun regex "i" bayragi Turkce harf
   * kurallarini bilmez ("İ" -> "i" eslesmez).
   */
  searchTerms: string[];
}

/** GeoJSON noktasi: koordinat sirasi [BOYLAM, ENLEM] - tersi degil. */
export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface DarkStoreDocument extends BaseDocument {
  name: string;
  /** 2dsphere indeksi bu alan uzerindedir (ResolveDarkStore, T4.2). */
  location: GeoPoint;
  deliveryRadiusMeters: number;
  isOpen: boolean;
}
