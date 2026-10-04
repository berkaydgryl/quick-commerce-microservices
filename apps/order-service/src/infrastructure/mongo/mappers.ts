/**
 * Domain <-> Mongo belgesi cevirisi. Tek yer: alan adi degisirse tek dosya degisir.
 */

import type { OrderItem, OrderPricing } from '../../domain/order-item.js';
import type { Order, TimelineEntry } from '../../domain/order.js';
import type {
  OrderDocument,
  OrderItemDocument,
  OrderPricingDocument,
  TimelineEntryDocument,
} from './documents.js';

function toTimelineEntryDocument(entry: TimelineEntry): TimelineEntryDocument {
  return entry.note === undefined
    ? { status: entry.status, at: entry.at }
    : { status: entry.status, at: entry.at, note: entry.note };
}

function fromTimelineEntryDocument(document: TimelineEntryDocument): TimelineEntry {
  return document.note === undefined
    ? { status: document.status, at: document.at }
    : { status: document.status, at: document.at, note: document.note };
}

function toItemDocument(item: OrderItem): OrderItemDocument {
  return {
    productId: item.productId,
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    lineTotalMinor: item.lineTotalMinor,
  };
}

function fromItemDocument(document: OrderItemDocument): OrderItem {
  return {
    productId: document.productId,
    sku: document.sku,
    name: document.name,
    unit: document.unit,
    quantity: document.quantity,
    unitPriceMinor: document.unitPriceMinor,
    lineTotalMinor: document.lineTotalMinor,
  };
}

function toPricingDocument(pricing: OrderPricing): OrderPricingDocument {
  const base = {
    currency: pricing.currency,
    subtotalMinor: pricing.subtotalMinor,
    deliveryFeeMinor: pricing.deliveryFeeMinor,
    discountMinor: pricing.discountMinor,
    totalMinor: pricing.totalMinor,
  };
  return pricing.couponCode === undefined ? base : { ...base, couponCode: pricing.couponCode };
}

function fromPricingDocument(document: OrderPricingDocument): OrderPricing {
  const base = {
    currency: document.currency,
    subtotalMinor: document.subtotalMinor,
    deliveryFeeMinor: document.deliveryFeeMinor,
    discountMinor: document.discountMinor,
    totalMinor: document.totalMinor,
  };
  return document.couponCode === undefined ? base : { ...base, couponCode: document.couponCode };
}

export function toOrderDocument(order: Order): OrderDocument {
  return {
    _id: order.id,
    userId: order.userId,
    marketId: order.marketId,
    items: order.items.map(toItemDocument),
    pricing: toPricingDocument(order.pricing),
    deliveryLocation: { lat: order.deliveryLocation.lat, lng: order.deliveryLocation.lng },
    deliveryAddress: order.deliveryAddress,
    status: order.status,
    timeline: order.timeline.map(toTimelineEntryDocument),
    ...(order.riskBand === undefined ? {} : { riskBand: order.riskBand }),
    ...(order.reservation === undefined
      ? {}
      : {
          reservation: {
            reservedAt: order.reservation.reservedAt,
            expiresAt: order.reservation.expiresAt,
          },
        }),
    ...(order.courier === undefined
      ? {}
      : {
          courier: { courierId: order.courier.courierId, assignedAt: order.courier.assignedAt },
        }),
    ...(order.courierRetryAt === undefined ? {} : { courierRetryAt: order.courierRetryAt }),
    ...(order.courierQueuedAt === undefined ? {} : { courierQueuedAt: order.courierQueuedAt }),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    version: order.version,
  };
}

export function fromOrderDocument(document: OrderDocument): Order {
  return {
    id: document._id,
    userId: document.userId,
    marketId: document.marketId,
    items: document.items.map(fromItemDocument),
    pricing: fromPricingDocument(document.pricing),
    deliveryLocation: { lat: document.deliveryLocation.lat, lng: document.deliveryLocation.lng },
    deliveryAddress: document.deliveryAddress,
    status: document.status,
    timeline: document.timeline.map(fromTimelineEntryDocument),
    ...(document.riskBand === undefined ? {} : { riskBand: document.riskBand }),
    ...(document.reservation === undefined
      ? {}
      : {
          reservation: {
            reservedAt: document.reservation.reservedAt,
            expiresAt: document.reservation.expiresAt,
          },
        }),
    ...(document.courier === undefined
      ? {}
      : {
          courier: {
            courierId: document.courier.courierId,
            assignedAt: document.courier.assignedAt,
          },
        }),
    ...(document.courierRetryAt === undefined ? {} : { courierRetryAt: document.courierRetryAt }),
    ...(document.courierQueuedAt === undefined
      ? {}
      : { courierQueuedAt: document.courierQueuedAt }),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}
