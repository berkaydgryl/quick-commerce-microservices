/**
 * Kullanicinin siparis gecmisi (ListMyOrders) okuma portu.
 *
 * SIRA: yeniden eskiye (createdAt azalan; esitlikte kimlik azalan). Sayfalama
 * imlecle yapilir, offset ile degil: kullanici listeyi gezerken yeni siparis
 * verirse offset kayar ve ayni siparis iki sayfada gorunur.
 */

import { ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';

import type { OrderHistoryCursor } from './order-history-cursor.js';
import type { Order } from './order.js';

/**
 * Odemesi ALINMIS siparis durumlari: ILK10 "ilk siparis" kurali bunlara bakar
 * (T7.2). Taslak, iptal, suresi dolmus ya da odemesi basarisiz siparis
 * "verilmis siparis" sayilmaz; kullanici ilk siparis indirimini kaybetmez.
 * Odenip iade edilen (PAID -> CANCELLED) siparis de sayilmaz: tamamlanmadi.
 */
export const PAID_ORDER_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUS.PAID,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.ON_THE_WAY,
  ORDER_STATUS.DELIVERED,
];

export interface OrderHistoryQuery {
  readonly userId: string;
  /** Sozlesme sinirlarina oturtulmus sayfa boyutu (1..100; kirpma istek semasinda). */
  readonly pageSize: number;
  /** Onceki sayfanin son siparisi; ilk sayfada tanimsiz. */
  readonly after?: OrderHistoryCursor | undefined;
}

export interface OrderHistoryPage {
  readonly orders: readonly Order[];
  /** Sonraki sayfa varsa bu sayfanin son siparisi; yoksa tanimsiz. */
  readonly next?: OrderHistoryCursor | undefined;
}

export interface OrderHistoryReader {
  listByUser(query: OrderHistoryQuery): Promise<OrderHistoryPage>;
  /** Kullanicinin PAID_ORDER_STATUSES'ta en az bir siparisi var mi? (ILK10) */
  hasPaidOrder(userId: string): Promise<boolean>;
}
