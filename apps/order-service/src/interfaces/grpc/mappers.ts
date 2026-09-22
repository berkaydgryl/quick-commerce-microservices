/**
 * Domain -> sozlesme (proto) cevirisi.
 *
 * Domain durumlari @getir/core'daki ORDER_STATUS sozlugunden gelir; proto ise
 * ORDER_STATUS_* onekli enum tasir. Esleme Record ile yazildi: yeni bir durum
 * eklendiginde eksik esleme DERLEMEDE yakalanir, calisma zamaninda degil.
 */

import { ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { orderV1 } from '@getir/proto';

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
