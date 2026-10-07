/**
 * Gecmis Siparislerim'de (ListMyOrders) hangi siparis GORUNUR (#101, T11.16).
 * Tek kaynak: bellek deposu bu kuralla suzer, Mongo eslemesi her yazimda bu
 * kuraldan `inHistory` alanini turetir.
 *
 * Gecmis, kullanicinin GERCEKTEN verdigi siparislerdir:
 *   - odemesi alinmis ve sonrasi: PAID, PREPARING, ON_THE_WAY, DELIVERED;
 *   - incelemede bekleyen: REVIEW (kullanici siparisi verdi, karar bekliyor);
 *   - parasi alindiktan sonra iptal edilen: CANCELLED ve zaman cizelgesinde
 *     PAID kaydi ya da iade isareti var. Iade isareti (#166, order-refund.ts)
 *     kilidi dusmus odemeyi kapsar: para alinmis ama siparis PAID olmadan
 *     iptal edilip iade edilmistir (istemcinin "Iade edildi" etiketi bugun
 *     yalnizca PAID kaydina bakar; isaret proto + gateway zincirinde tasinir).
 * Gizli olanlar sepet asamasidir: taslak, kilit, odeme bekleyen, suresi dolan,
 * odemesi basarisiz, reddedilen ve odenmeden iptal edilen (sepeti birakma,
 * yeni sepet, kilidin dusmesi, kullanicinin odeme oncesi iptali).
 *
 * Bilinen kenar (kabul): REVIEW'dan onaylanip odeme bekleyen siparis
 * (RESERVED, AWAITING_PAYMENT) listeden cikar, odenince geri gelir.
 *
 * Saf: I/O yok. Tablo Record<OrderStatus, ...>: @getir/core'a yeni bir durum
 * eklenip burada karari verilmezse DERLEME kirilir.
 */

import { ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';

import type { Order } from './order.js';

/** Durumun gecmisteki yeri: hep gorunur, hep gizli ya da parasi alindiysa gorunur. */
export type HistoryListing = 'LISTED' | 'HIDDEN' | 'LISTED_IF_CHARGED';

export const HISTORY_LISTING: Readonly<Record<OrderStatus, HistoryListing>> = {
  [ORDER_STATUS.DRAFT]: 'HIDDEN',
  [ORDER_STATUS.RISK_CHECK]: 'HIDDEN',
  [ORDER_STATUS.REVIEW]: 'LISTED',
  [ORDER_STATUS.RESERVED]: 'HIDDEN',
  [ORDER_STATUS.AWAITING_PAYMENT]: 'HIDDEN',
  [ORDER_STATUS.PAID]: 'LISTED',
  [ORDER_STATUS.PAYMENT_FAILED]: 'HIDDEN',
  [ORDER_STATUS.EXPIRED]: 'HIDDEN',
  [ORDER_STATUS.CANCELLED]: 'LISTED_IF_CHARGED',
  [ORDER_STATUS.REJECTED]: 'HIDDEN',
  [ORDER_STATUS.PREPARING]: 'LISTED',
  [ORDER_STATUS.ON_THE_WAY]: 'LISTED',
  [ORDER_STATUS.DELIVERED]: 'LISTED',
};

/** Siparis Gecmis Siparislerim'de gorunur mu? */
export function isListedInHistory(order: Pick<Order, 'status' | 'timeline' | 'refund'>): boolean {
  switch (HISTORY_LISTING[order.status]) {
    case 'LISTED':
      return true;
    case 'HIDDEN':
      return false;
    case 'LISTED_IF_CHARGED':
      return (
        order.refund !== undefined ||
        order.timeline.some((entry) => entry.status === ORDER_STATUS.PAID)
      );
  }
}
