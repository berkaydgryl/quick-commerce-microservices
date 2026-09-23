/**
 * Kullanicinin siparis gecmisi (ListMyOrders) okuma portu.
 *
 * SIRA: yeniden eskiye (createdAt azalan; esitlikte kimlik azalan). Sayfalama
 * imlecle yapilir, offset ile degil: kullanici listeyi gezerken yeni siparis
 * verirse offset kayar ve ayni siparis iki sayfada gorunur.
 */

import type { OrderHistoryCursor } from './order-history-cursor.js';
import type { Order } from './order.js';

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
}
