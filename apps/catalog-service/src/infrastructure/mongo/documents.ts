/**
 * Katalog koleksiyonlarinin Mongo'daki SEKLI (ADR-15).
 *
 * Domain tipinden ayri tutulur: belge, sorguyu hizlandirmak icin domain'de
 * olmayan alanlar tasir (offers'taki kopyalar, searchTerms) ve konumu GeoJSON
 * olarak saklar. Ceviri tek yerdedir: mappers.ts.
 */

import type { BaseDocument } from '@getir/mongo-kit';

import type { ProductUnit } from '../../domain/catalog.js';

/** Koleksiyon adlari - roadmap "MongoDB Veri Modeli" tablosuyla ayni. */
export const COLLECTIONS = {
  CATEGORIES: 'categories',
  PRODUCTS: 'products',
  MARKETS: 'markets',
  OFFERS: 'offers',
} as const;

export interface CategoryDocument extends BaseDocument {
  name: string;
  slug: string;
  sortOrder: number;
  /** GORELI yol; mutlak URL'yi gateway kurar. */
  imageUrl: string;
}

/** Ortak urun. Fiyat YOK (ADR-15). */
export interface ProductDocument extends BaseDocument {
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  unit: ProductUnit;
  imageUrl: string;
}

/** GeoJSON noktasi: koordinat sirasi [BOYLAM, ENLEM] - tersi degil. */
export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface MarketDocument extends BaseDocument {
  name: string;
  brand: string;
  logoUrl: string;
  /** 2dsphere indeksi bu alan uzerindedir (ListNearbyMarkets, $geoNear). */
  location: GeoPoint;
  deliveryRadiusMeters: number;
  isOpen: boolean;
  deliveryTime: { minMinutes: number; maxMinutes: number };
  rating: { averageTenths: number; count: number };
  pricingRules: {
    minBasketMinor: number;
    deliveryFeeMinor: number;
    freeDeliveryThresholdMinor: number;
  };
}

/**
 * Teklif: fiyatin sahibi.
 *
 * Listeleme alanlari (productSnapshot) urunden KOPYALANIR: market sayfasi tek
 * sorguda, $lookup ve N+1 olmadan listelenir. Kopyayi YALNIZCA catalog'un
 * seeder'i yazar; urun degistiginde tekliflerle birlikte yeniden yazilir.
 */
export interface OfferDocument extends BaseDocument {
  marketId: string;
  productId: string;
  priceMinor: number;
  isActive: boolean;
  /** Listeleme ve kategori filtresi icin kopya. */
  product: ProductDocument;
  /** Kategori filtresi + imlec indeksi icin ust seviyede tekrar edilir. */
  categoryId: string;
  /**
   * Arama icin normalize edilmis ad ve aciklama (domain/searchKey). Mongo'nun
   * regex "i" bayragi Turkce harf kurallarini bilmez ("İ" -> "i" eslesmez).
   */
  searchTerms: string[];
}
