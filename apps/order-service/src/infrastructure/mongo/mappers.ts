/**
 * Domain <-> Mongo belgesi cevirisi. Tek yer: alan adi degisirse tek dosya degisir.
 */

import type { Order, TimelineEntry } from '../../domain/order.js';
import type { OrderDocument, TimelineEntryDocument } from './documents.js';

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

export function toOrderDocument(order: Order): OrderDocument {
  return {
    _id: order.id,
    userId: order.userId,
    marketId: order.marketId,
    lines: order.lines.map((line) => ({ ...line })),
    deliveryLocation: { lat: order.deliveryLocation.lat, lng: order.deliveryLocation.lng },
    deliveryAddress: order.deliveryAddress,
    status: order.status,
    timeline: order.timeline.map(toTimelineEntryDocument),
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
    lines: document.lines.map((line) => ({
      productId: line.productId,
      sku: line.sku,
      quantity: line.quantity,
    })),
    deliveryLocation: { lat: document.deliveryLocation.lat, lng: document.deliveryLocation.lng },
    deliveryAddress: document.deliveryAddress,
    status: document.status,
    timeline: document.timeline.map(fromTimelineEntryDocument),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}
