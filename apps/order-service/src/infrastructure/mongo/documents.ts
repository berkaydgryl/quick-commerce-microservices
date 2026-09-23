/**
 * Siparis koleksiyonunun Mongo'daki SEKLI.
 *
 * Domain tipinden ayri tutulur: alan adi ya da saklama bicimi degisirse
 * domain ve use-case'ler etkilenmez. Ceviri tek yerdedir: mappers.ts.
 */

import type { OrderStatus } from '@getir/core';
import type { BaseDocument } from '@getir/mongo-kit';

/** Koleksiyon adlari - roadmap "MongoDB Veri Modeli" tablosuyla ayni. */
export const COLLECTIONS = {
  ORDERS: 'orders',
} as const;

export interface CartLineDocument {
  productId: string;
  sku: string;
  quantity: number;
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
  lines: CartLineDocument[];
  deliveryLocation: { lat: number; lng: number };
  deliveryAddress: string;
  status: OrderStatus;
  timeline: TimelineEntryDocument[];
  createdAt: Date;
  updatedAt: Date;
  /** Iyimser kilit surumu; guncelleme filtresi bunu kosul olarak kullanir. */
  version: number;
}
