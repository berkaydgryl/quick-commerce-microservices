/** Kurye <-> belge cevirisi. Yok olan istege bagli alan iki yonde de HIC yazilmaz. */

import type { Courier } from '../../domain/courier.js';
import type { CourierDocument } from './documents.js';

export function toCourierDocument(courier: Courier): CourierDocument {
  return {
    _id: courier.id,
    name: courier.name,
    marketId: courier.marketId,
    status: courier.status,
    ...(courier.currentOrderId === undefined ? {} : { currentOrderId: courier.currentOrderId }),
    ...(courier.lastAssignedAt === undefined ? {} : { lastAssignedAt: courier.lastAssignedAt }),
    lastLocation: { lat: courier.lastLocation.lat, lng: courier.lastLocation.lng },
    lastLocationAt: courier.lastLocationAt,
  };
}

export function fromCourierDocument(document: CourierDocument): Courier {
  return {
    id: document._id,
    name: document.name,
    marketId: document.marketId,
    status: document.status,
    ...(document.currentOrderId === undefined ? {} : { currentOrderId: document.currentOrderId }),
    ...(document.lastAssignedAt === undefined ? {} : { lastAssignedAt: document.lastAssignedAt }),
    lastLocation: { lat: document.lastLocation.lat, lng: document.lastLocation.lng },
    lastLocationAt: document.lastLocationAt,
  };
}
