/**
 * Domain -> sozlesme (proto) cevirisi: durum sozlugu ve siparis kaydi.
 *
 * Domain durumlari @getir/core'daki ORDER_STATUS sozlugunden gelir; proto ise
 * ORDER_STATUS_* onekli enum tasir. Esleme Record ile yazildi: yeni bir durum
 * eklendiginde eksik esleme DERLEMEDE yakalanir, calisma zamaninda degil.
 */

import { ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { orderV1 } from '@getir/proto';

import type { Order, TimelineEntry } from '../../domain/order.js';

const STATUS_TO_PROTO: Readonly<Record<OrderStatus, orderV1.OrderStatus>> = {
  [ORDER_STATUS.DRAFT]: orderV1.OrderStatus.ORDER_STATUS_DRAFT,
  [ORDER_STATUS.RISK_CHECK]: orderV1.OrderStatus.ORDER_STATUS_RISK_CHECK,
  [ORDER_STATUS.REVIEW]: orderV1.OrderStatus.ORDER_STATUS_REVIEW,
  [ORDER_STATUS.REJECTED]: orderV1.OrderStatus.ORDER_STATUS_REJECTED,
  [ORDER_STATUS.RESERVED]: orderV1.OrderStatus.ORDER_STATUS_RESERVED,
  [ORDER_STATUS.EXPIRED]: orderV1.OrderStatus.ORDER_STATUS_EXPIRED,
  [ORDER_STATUS.AWAITING_PAYMENT]: orderV1.OrderStatus.ORDER_STATUS_AWAITING_PAYMENT,
  [ORDER_STATUS.PAYMENT_FAILED]: orderV1.OrderStatus.ORDER_STATUS_PAYMENT_FAILED,
  [ORDER_STATUS.PAID]: orderV1.OrderStatus.ORDER_STATUS_PAID,
  [ORDER_STATUS.CANCELLED]: orderV1.OrderStatus.ORDER_STATUS_CANCELLED,
  [ORDER_STATUS.PREPARING]: orderV1.OrderStatus.ORDER_STATUS_PREPARING,
  [ORDER_STATUS.ON_THE_WAY]: orderV1.OrderStatus.ORDER_STATUS_ON_THE_WAY,
  [ORDER_STATUS.DELIVERED]: orderV1.OrderStatus.ORDER_STATUS_DELIVERED,
};

export function toProtoOrderStatus(status: OrderStatus): orderV1.OrderStatus {
  return STATUS_TO_PROTO[status];
}

function toProtoTimelineEntry(entry: TimelineEntry): orderV1.OrderTimelineEntry {
  return { status: toProtoOrderStatus(entry.status), at: entry.at, note: entry.note ?? '' };
}

/**
 * Siparis -> proto Order.
 *
 * BILEREK BOS BIRAKILANLAR (sozlesme bunlara izin verir, uydurma deger yazilmaz):
 *   - items, subtotal, delivery_fee, discount, total: siparis bugun HAM sepet
 *     satiri tasir; fiyati dondurulmus kalem ve toplamlar, katalog teklifleri
 *     toplu okununca (BatchGetOffers, T9.3) ve pricing baglaninca olusur.
 *     "0 TL" yazmak istemciye yanlis bir tutar gosterirdi; alan yok = hesaplanmadi.
 *   - reservation_expires_at: stok rezervasyonu T11.2'de.
 *   - dark_store_id: kullanimdan kalkti (ADR-15); yerini market_id aldi.
 */
export function toProtoOrder(order: Order): orderV1.Order {
  return {
    id: order.id,
    userId: order.userId,
    darkStoreId: '',
    marketId: order.marketId,
    status: toProtoOrderStatus(order.status),
    items: [],
    deliveryLocation: { lat: order.deliveryLocation.lat, lng: order.deliveryLocation.lng },
    deliveryAddress: order.deliveryAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    timeline: order.timeline.map(toProtoTimelineEntry),
  };
}
