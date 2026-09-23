/**
 * Siparis alaninin (domain) varliklari ve saf kurallari.
 *
 * KURAL: bu dosya DISARI BAKMAZ - mongodb, ioredis, grpc ya da uretilen proto
 * tipi importu yoktur. @getir/core bir istisna degil, PAYLASILAN CEKIRDEKTIR:
 * saf TypeScript, I/O icermez ve siparis durumlari (ORDER_STATUS) zaten
 * servisler arasi ortak sozlukte tanimlidir.
 *
 * Durum gecisleri order-state-machine.ts'teki TABLODAN gecer (T4.4); her gecis
 * zaman cizelgesine (timeline) bir kayit ekler. Mongo kalicilik T4.5'tedir.
 */

import { ID_PREFIX, newId, ORDER_STATUS } from '@getir/core';
import type { Clock, OrderStatus } from '@getir/core';

import { assertTransition } from './order-state-machine.js';

/** Sepetten gelen ham satir. FIYAT TASIMAZ (istemciden gelen fiyata guvenilmez). */
export interface CartLine {
  readonly productId: string;
  readonly sku: string;
  readonly quantity: number;
}

/**
 * Zaman cizelgesi kaydi: siparisin gectigi her durum, ne zaman ve (varsa)
 * neden. UI "Siparisin alindi 14:02, hazirlaniyor 14:05" seridini bundan
 * cizer (proto OrderTimelineEntry).
 */
export interface TimelineEntry {
  readonly status: OrderStatus;
  readonly at: Date;
  /** Istege bagli kisa aciklama ANAHTARI (TIMELINE_NOTE ya da iptal gerekcesi). */
  readonly note?: string;
}

/**
 * Sistemin yazdigi not anahtarlari. Metin degil ANAHTAR: istemci kullanici
 * diline kendisi cevirir, sunucu cevrilmis metin gondermez.
 */
export const TIMELINE_NOTE = {
  /** Risk servisi henuz bagli degil (T6.3): adim degerlendirmesiz gecti. */
  PENDING_RISK_SERVICE: 'PENDING_RISK_SERVICE',
  /** Stok rezervasyonu henuz yok (T11.2): adim kilitsiz gecti. */
  PENDING_RESERVATION: 'PENDING_RESERVATION',
  /** Kullanici gerekce vermeden iptal etti. */
  USER_CANCELLED: 'USER_CANCELLED',
} as const;

export interface DeliveryLocation {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Siparis kaydi (iskelet hali).
 *
 * Kalemler bugun HAM SEPET satiri olarak duruyor; fiyati dondurulmus OrderItem
 * ve toplamlar, fiyatlandirma paketi (T4.3) ile katalog fiyatlarinin okunmasi
 * geldiginde olusacak. Bugun tutar hesaplamak, sonradan atilacak bir kod
 * yazmak olurdu.
 */
export interface Order {
  readonly id: string;
  readonly userId: string;
  readonly darkStoreId: string;
  readonly lines: readonly CartLine[];
  readonly deliveryLocation: DeliveryLocation;
  readonly deliveryAddress: string;
  readonly status: OrderStatus;
  /** Eskiden yeniye; ilk kayit her zaman DRAFT. Yalnizca EKLENIR, degistirilmez. */
  readonly timeline: readonly TimelineEntry[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DraftOrderInput {
  readonly userId: string;
  readonly darkStoreId: string;
  readonly lines: readonly CartLine[];
  readonly deliveryLocation: DeliveryLocation;
  readonly deliveryAddress: string;
}

/**
 * Yeni taslak siparis uretir.
 *
 * KIMLIK BURADA URETILIR (B8): rezervasyon, henuz olmayan bir siparisin
 * kimligiyle acilamaz; once order-service DRAFT siparisi acar ve kimligi verir.
 * Zaman `Clock` uzerinden okunur - is mantigi icinde Date.now() cagrilmaz,
 * boylece testte saat sabitlenebilir.
 */
export function createDraftOrder(input: DraftOrderInput, clock: Clock): Order {
  const now = clock.date();

  return {
    id: newId(ID_PREFIX.ORDER),
    userId: input.userId,
    darkStoreId: input.darkStoreId,
    lines: input.lines,
    deliveryLocation: input.deliveryLocation,
    deliveryAddress: input.deliveryAddress,
    status: ORDER_STATUS.DRAFT,
    timeline: [{ status: ORDER_STATUS.DRAFT, at: now }],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Siparisi yeni duruma GECIRIR: tablo kontrolu + zaman cizelgesi kaydi.
 *
 * Tek gecis yolu budur; durumu dogrudan degistiren baska bir fonksiyon yok.
 * Yeni nesne dondurur (mutasyon yok); timeline'a yalnizca EKLENIR.
 *
 * @throws AppError ORDER_STATE_INVALID - tabloda olmayan gecis.
 */
export function transitionOrder(order: Order, to: OrderStatus, clock: Clock, note?: string): Order {
  assertTransition(order.id, order.status, to);
  const at = clock.date();
  const entry: TimelineEntry = note === undefined ? { status: to, at } : { status: to, at, note };
  return { ...order, status: to, timeline: [...order.timeline, entry], updatedAt: at };
}
