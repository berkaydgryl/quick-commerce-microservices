/**
 * Siparisin stok rezervasyonu kurallari (T11.2, ADR-01). Saf: inventory'ye
 * bakmaz, yalnizca karar verir.
 *
 * Yasam dongusu: taslak acilirken kilitlenir (Reserve), odeme alininca
 * kesinlesir (Commit), saga durunca birakilir (Release). Birakilamazsa kilit
 * suresi dolunca inventory'nin supurucusu stoku geri verir. Arada suresi
 * ayarlanir (T11.3): orta bantta kisalir, odeme oncesi gerekirse uzar.
 */

import { ERROR_CODES, ORDER_STATUS, RISK_BANDS } from '@getir/core';
import type { OrderStatus, RiskBand } from '@getir/core';

import type { Order } from './order.js';
import { TIMELINE_NOTE } from './order.js';

/**
 * Birakma gerekcesi: inventory stok defterine oldugu gibi yazar. Bicim
 * inventory'nin kurali (@getir/contracts RELEASE_REASON_PATTERN): kucuk harf,
 * rakam ve alt cizgi.
 */
export const RELEASE_REASON = {
  USER_CANCELLED: 'user_cancelled',
  RISK_REJECTED: 'risk_rejected',
  RISK_REVIEW: 'risk_review',
  PAYMENT_FAILED: 'payment_failed',
  CART_REPLACED: 'cart_replaced',
  RESERVATION_EXPIRED: 'reservation_expired',
  /** Kilit alindi ama taslak yazilamadi: kilit hemen geri verilir. */
  DRAFT_NOT_SAVED: 'draft_not_saved',
  /** Saga'nin birakamadigi kilit, kullanicinin yeni sepetinde bulunup birakildi. */
  STALE_LOCK: 'stale_lock',
} as const;

export type ReleaseReason = (typeof RELEASE_REASON)[keyof typeof RELEASE_REASON];

/**
 * Taslagin kilidi gecerli mi? Kilidi hic olmayan taslak (T11.2 oncesi acilmis)
 * da gecersiz sayilir: siparis kilitsiz stokla ilerlemez.
 */
export function hasLiveReservation(order: Order, now: Date): boolean {
  return order.reservation !== undefined && order.reservation.expiresAt.getTime() > now.getTime();
}

/**
 * Bant kilidi kisaltir mi (T11.3, roadmap "Bantlar ve aksiyonlar"): orta risk
 * bandinda kilit 2 dk. Sure ortamdan (RESERVATION_TTL_MEDIUM_RISK_SECONDS);
 * dusuk bant taslagin kilidiyle devam eder, yuksek ve kritik bant kilidi birakir.
 */
export function shortensLock(band: RiskBand): boolean {
  return band === RISK_BANDS.MEDIUM;
}

/**
 * Kilidin inventory'deki yeni bitisi siparise islenir (T11.3). Surum DEGISMEZ:
 * cagiran ayni yazimda bir durum gecisi yazar (risk adimi). Kilitsiz eski
 * siparis oldugu gibi doner.
 */
export function withReservationExpiry(order: Order, expiresAt: Date): Order {
  return order.reservation === undefined
    ? order
    : { ...order, reservation: { ...order.reservation, expiresAt } };
}

/**
 * Kilit uzatildi ve kaydi TEK BASINA yazilacak (odeme oncesi, T11.3): surum
 * artar ki ayni siparisi eski haliyle yazan (supurucu) CONFLICT alsin. Durum
 * degismez: zaman cizelgesine kayit eklenmez, olay uretilmez.
 */
export function rescheduleReservation(order: Order, expiresAt: Date, at: Date): Order {
  return { ...withReservationExpiry(order, expiresAt), updatedAt: at, version: order.version + 1 };
}

/**
 * Odeme ya da 3DS denemesinden once kilit uzatilmali mi (B21, #72): kalan sure
 * `windowMs`'ten az. Kilitsiz eski siparis uzatilmaz.
 */
export function needsLockExtension(order: Order, now: Date, windowMs: number): boolean {
  return (
    order.reservation !== undefined &&
    order.reservation.expiresAt.getTime() - now.getTime() < windowMs
  );
}

/**
 * Kilidi dolunca supurucunun KAPATTIGI durumlar (T11.2 PR 2): kilit tutan ve
 * kayitta kalabilen iki durum. RISK_CHECK ve RESERVED tek yazimda gecilir,
 * kayitta durmaz.
 */
export const EXPIRY_SWEPT_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.AWAITING_PAYMENT,
];

/**
 * Siparisin kilidi `now` itibariyla dolmus mu ve supurucu onu kapatir mi?
 * Kilidi hic olmayan eski (T11.2 oncesi) siparis supurulmez.
 */
export function hasExpiredReservation(order: Order, now: Date): boolean {
  return (
    EXPIRY_SWEPT_STATUSES.includes(order.status) &&
    order.reservation !== undefined &&
    order.reservation.expiresAt.getTime() <= now.getTime()
  );
}

/**
 * Saga'nin kilidi BIRAKTIGI durumlar: iptal, ret, inceleme, odeme hatasi, sure
 * dolumu. Birakma en iyi gayretle yapilir (application/stock-step.ts); basarisiz
 * kaldiysa kilit inventory'de durur ve kullaniciyi suresi dolana kadar yeni
 * sepetten alikoyar. Bu durumdaki siparisin kilidi bulunursa birakilabilir:
 * sonradan gelen Commit NOT_FOUND alir ve odeme iade edilir (stok fazla satilmaz).
 */
const LOCK_RELEASED_STATUSES: ReadonlySet<OrderStatus> = new Set([
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REJECTED,
  ORDER_STATUS.REVIEW,
  ORDER_STATUS.PAYMENT_FAILED,
  ORDER_STATUS.EXPIRED,
]);

/** Siparisin kilidi artik birakilmis olmali mi? */
export function holdsNoStock(order: Order): boolean {
  return LOCK_RELEASED_STATUSES.has(order.status);
}

/**
 * Sistemin taslak iptal notlari (T11.2): stok yetmedi, sure doldu, sepet
 * yenilendi. Kullanici davranisi DEGIL; risk gecmisinde "iptal" sayilmaz.
 * Saga'nin durduran adimlari gibi hata sozlugunun anahtarini yazar (sepet
 * yenileme bir hata olmadigi icin TIMELINE_NOTE).
 */
export const SYSTEM_CANCELLATION_NOTES: readonly string[] = [
  ERROR_CODES.STOCK_INSUFFICIENT,
  ERROR_CODES.RESERVATION_EXPIRED,
  TIMELINE_NOTE.CART_REPLACED,
];

/** Siparis sistem tarafindan mi iptal edildi (son kaydin notu)? */
export function isSystemCancellation(order: Order): boolean {
  const last = order.timeline.at(-1);
  return (
    order.status === ORDER_STATUS.CANCELLED &&
    last?.note !== undefined &&
    SYSTEM_CANCELLATION_NOTES.includes(last.note)
  );
}
