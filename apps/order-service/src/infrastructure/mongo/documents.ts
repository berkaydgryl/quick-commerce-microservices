/**
 * Siparis koleksiyonunun Mongo'daki SEKLI.
 *
 * Domain tipinden ayri tutulur: alan adi ya da saklama bicimi degisirse
 * domain ve use-case'ler etkilenmez. Ceviri tek yerdedir: mappers.ts.
 */

import type { OrderStatus, RiskBand } from '@getir/core';
import type { BaseDocument } from '@getir/mongo-kit';

import type { ItemUnit } from '../../domain/order-item.js';

/** Koleksiyon adlari - roadmap "MongoDB Veri Modeli" tablosuyla ayni. */
export const COLLECTIONS = {
  ORDERS: 'orders',
} as const;

/** Fiyati dondurulmus kalem; tutarlar kurus, tam sayi. */
export interface OrderItemDocument {
  productId: string;
  sku: string;
  name: string;
  unit: ItemUnit;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

/** Siparisin dondurulmus tutari (T7.2). Kupon yoksa alan HIC yazilmaz. */
export interface OrderPricingDocument {
  currency: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  couponCode?: string;
}

export interface TimelineEntryDocument {
  status: OrderStatus;
  at: Date;
  /** Not yoksa alan HIC yazilmaz (null degil). */
  note?: string;
}

/**
 * Teslimat konumu duz {lat, lng}: bu koleksiyonda konum SORGUSU yok, yalnizca
 * gosterim ve kurye rotasi icin saklanir. GeoJSON + 2dsphere, yakinlik
 * sorgusu gereken yerdedir (catalog markets).
 */
export interface OrderDocument extends BaseDocument {
  userId: string;
  marketId: string;
  items: OrderItemDocument[];
  pricing: OrderPricingDocument;
  deliveryLocation: { lat: number; lng: number };
  deliveryAddress: string;
  status: OrderStatus;
  timeline: TimelineEntryDocument[];
  /** Risk adimindan once HIC yazilmaz (T7.1). */
  riskBand?: RiskBand;
  createdAt: Date;
  updatedAt: Date;
  /** Iyimser kilit surumu; guncelleme filtresi bunu kosul olarak kullanir. */
  version: number;
}
