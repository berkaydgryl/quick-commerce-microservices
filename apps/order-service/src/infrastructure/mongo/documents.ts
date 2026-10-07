/**
 * Siparis koleksiyonunun Mongo'daki SEKLI.
 *
 * Domain tipinden ayri tutulur: alan adi ya da saklama bicimi degisirse
 * domain ve use-case'ler etkilenmez. Ceviri tek yerdedir: mappers.ts.
 */

import type { EventName, OrderStatus, RiskBand } from '@getir/core';
import type { BaseDocument } from '@getir/mongo-kit';

import type { PaymentMethod } from '../../domain/checkout-payment.js';
import type { ItemUnit } from '../../domain/order-item.js';
import type { DeliveryPaymentKind } from '../../domain/order-payment.js';

/** Koleksiyon adlari - roadmap "MongoDB Veri Modeli" tablosuyla ayni. */
export const COLLECTIONS = {
  ORDERS: 'orders',
  /** Siparisin olaylari (ADR-04): siparisle AYNI transaction'da yazilir. */
  OUTBOX: 'outbox',
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
 * Siparis ayrintilari (T12.4). Kisisel veri (adlar, telefon, not, mesaj):
 * yalnizca bu belgede durur, olaylara (outbox) kopyalanmaz. Hediye yoksa
 * `gift` HIC yazilmaz.
 */
export interface OrderDetailsDocument {
  gift?: { message: string; senderName: string; recipientName: string; recipientPhone: string };
  note: string;
  doNotRingBell: boolean;
  agreementsAcceptedAt: Date;
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
  /** Stok kilidi (T11.2); kilitlenemeyen ve T11.2 oncesi taslakta HIC yok. */
  reservation?: { reservedAt: Date; expiresAt: Date };
  /** Atanan kurye (T13.1 PR 2); atanmadan HIC yazilmaz. */
  courier?: { courierId: string; assignedAt: Date };
  /** Risk adiminda yazilir (T12.4); ayrintisiz ve T12.4 oncesi sipariste HIC yok. */
  details?: OrderDetailsDocument;
  /** Odeme secimi (T12.4): yontem ve kapida odemenin turu; eski sipariste HIC yok. */
  payment?: { method: PaymentMethod; onDelivery?: DeliveryPaymentKind };
  /** Kuryesiz PREPARING'in yeniden deneme ani; yalnizca o durumda var. */
  courierRetryAt?: Date;
  /** Kurye kuyrugundaki yer: odeme ani (#92); kurye ataninca silinir. */
  courierQueuedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  /** Iyimser kilit surumu; guncelleme filtresi bunu kosul olarak kullanir. */
  version: number;
}

/**
 * Outbox satiri (T7.3). _id olay kimligidir (evt_...): ayni olay iki kez
 * yazilamaz. `publishedAt` yayinlanana kadar null; yayinci null olanlari okur.
 * Roadmap veri modelindeki `type` alani burada `topic`tir (ADR-07 zarfiyla ayni ad).
 */
export interface OutboxDocument extends BaseDocument {
  topic: EventName;
  /** Siparis kimligi (bolum anahtari). */
  aggregateId: string;
  /** Olayin siparise getirdigi surum; ayni siparisin olaylari bu siraya gore yayinlanir. */
  version: number;
  occurredAt: Date;
  payload: Record<string, unknown>;
  publishedAt: Date | null;
  /** Olayi yazan istegin kimligi (D16); istek disi yazimda ve eski satirlarda yok. */
  requestId?: string;
  /** Olayi yazan istegin W3C iz baglami (D16); yayinci zarfa kopyalar. */
  traceparent?: string;
}
