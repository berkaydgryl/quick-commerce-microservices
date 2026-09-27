/**
 * Siparis alaninin (domain) varliklari ve saf kurallari.
 *
 * KURAL: bu dosya DISARI BAKMAZ - mongodb, ioredis, grpc ya da uretilen proto
 * tipi importu yoktur. @getir/core bir istisna degil, PAYLASILAN CEKIRDEKTIR:
 * saf TypeScript, I/O icermez ve siparis durumlari (ORDER_STATUS) zaten
 * servisler arasi ortak sozlukte tanimlidir.
 *
 * Durum gecisleri order-state-machine.ts'teki TABLODAN gecer (T4.4); her gecis
 * zaman cizelgesine (timeline) bir kayit ekler ve surumu (version) bir artirir.
 */

import { ID_PREFIX, newId, ORDER_STATUS } from '@getir/core';
import type { Clock, OrderStatus, RiskBand } from '@getir/core';

import type { OrderItem, OrderPricing } from './order-item.js';
import { assertTransition } from './order-state-machine.js';

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
 *
 * Saga'nin DURDURAN adimlari ayrica not sabiti tutmaz, hata sozlugunun
 * anahtarini yazar (T7.1): REVIEW -> RISK_REVIEW, REJECTED -> RISK_BLOCKED,
 * PAYMENT_FAILED -> PAYMENT_DECLINED / THREEDS_FAILED / SERVICE_UNAVAILABLE.
 * Istemci ayni anahtari hata mesajina zaten ceviriyor; ikinci sozluk olmaz.
 */
export const TIMELINE_NOTE = {
  /** Stok rezervasyonu henuz yok (T11.2): adim kilitsiz gecti. */
  PENDING_RESERVATION: 'PENDING_RESERVATION',
  /** Kullanici gerekce vermeden iptal etti. */
  USER_CANCELLED: 'USER_CANCELLED',
  /** Kapida odeme (T7.1): cekim yok, tutar teslimatta alinacak; siparis yine PAID'e gecer. */
  CASH_ON_DELIVERY: 'CASH_ON_DELIVERY',
} as const;

export interface DeliveryLocation {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Siparis kaydi.
 *
 * Kalemler ve tutar taslak acilirken catalog fiyatlarindan hesaplanip
 * DONDURULUR (T7.2): odeme adimi (CreateOrder, saga) yeniden hesaplamaz,
 * kullanici rezervasyon boyunca gordugu fiyattan oder.
 */
export interface Order {
  readonly id: string;
  readonly userId: string;
  /** Siparisin verildigi market (ADR-15): kullanicinin SECTIGI satici, mkt_ onekli. */
  readonly marketId: string;
  readonly items: readonly OrderItem[];
  readonly pricing: OrderPricing;
  readonly deliveryLocation: DeliveryLocation;
  readonly deliveryAddress: string;
  readonly status: OrderStatus;
  /** Eskiden yeniye; ilk kayit her zaman DRAFT. Yalnizca EKLENIR, degistirilmez. */
  readonly timeline: readonly TimelineEntry[];
  /**
   * Risk degerlendirmesinin bandi (T7.1); risk adimindan once YOK. Odeme adimi
   * kapida odeme ve 3DS kuralini bundan okur: cekim tekrar denendiginde risk
   * yeniden sorulmaz. Istemciye gosterilmez (proto Order'da alani yok).
   */
  readonly riskBand?: RiskBand;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /**
   * Iyimser kilit (optimistic concurrency) surumu: yeni taslak 1'dir, her gecis
   * bir artirir. Depo, okundugu surumden farkli bir kaydin USTUNE yazmaz; ayni
   * taslaga es zamanli iki CreateOrder/CancelOrder gelirse ikincisi CONFLICT alir.
   */
  readonly version: number;
}

/** Yeni taslagin surumu. */
export const INITIAL_ORDER_VERSION = 1;

export interface DraftOrderInput {
  readonly userId: string;
  readonly marketId: string;
  /** Fiyati dondurulmus kalemler ve tutar: price-draft.ts'in ciktisi. */
  readonly items: readonly OrderItem[];
  readonly pricing: OrderPricing;
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
    marketId: input.marketId,
    items: input.items,
    pricing: input.pricing,
    deliveryLocation: input.deliveryLocation,
    deliveryAddress: input.deliveryAddress,
    status: ORDER_STATUS.DRAFT,
    timeline: [{ status: ORDER_STATUS.DRAFT, at: now }],
    createdAt: now,
    updatedAt: now,
    version: INITIAL_ORDER_VERSION,
  };
}

/**
 * Siparisi yeni duruma GECIRIR: tablo kontrolu + zaman cizelgesi kaydi.
 *
 * Tek gecis yolu budur; durumu dogrudan degistiren baska bir fonksiyon yok.
 * Yeni nesne dondurur (mutasyon yok); timeline'a yalnizca EKLENIR, surum bir artar.
 *
 * @throws AppError ORDER_STATE_INVALID - tabloda olmayan gecis.
 */
export function transitionOrder(order: Order, to: OrderStatus, clock: Clock, note?: string): Order {
  assertTransition(order.id, order.status, to);
  const at = clock.date();
  const entry: TimelineEntry = note === undefined ? { status: to, at } : { status: to, at, note };
  return {
    ...order,
    status: to,
    timeline: [...order.timeline, entry],
    updatedAt: at,
    version: order.version + 1,
  };
}
