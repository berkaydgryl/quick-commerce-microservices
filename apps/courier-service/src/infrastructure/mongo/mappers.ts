/** Kurye ve market <-> belge cevirisi. Yok olan istege bagli alan iki yonde de HIC yazilmaz. */

import type { Courier, GeoPoint } from '../../domain/courier.js';
import type { MarketLocation } from '../../domain/market-locator.js';
import type { CourierDocument, GeoJsonPoint, MarketDocument } from './documents.js';

export function toGeoJson(point: GeoPoint): GeoJsonPoint {
  return { type: 'Point', coordinates: [point.lng, point.lat] };
}

export function fromGeoJson(point: GeoJsonPoint): GeoPoint {
  const [lng, lat] = point.coordinates;
  return { lat, lng };
}

export function toCourierDocument(courier: Courier): CourierDocument {
  return {
    _id: courier.id,
    name: courier.name,
    status: courier.status,
    ...(courier.currentOrderId === undefined ? {} : { currentOrderId: courier.currentOrderId }),
    ...(courier.lastAssignedAt === undefined ? {} : { lastAssignedAt: courier.lastAssignedAt }),
    ...(courier.idleSince === undefined ? {} : { idleSince: courier.idleSince }),
    lastLocation: toGeoJson(courier.lastLocation),
    lastLocationAt: courier.lastLocationAt,
  };
}

export function fromCourierDocument(document: CourierDocument): Courier {
  return {
    id: document._id,
    name: document.name,
    status: document.status,
    ...(document.currentOrderId === undefined ? {} : { currentOrderId: document.currentOrderId }),
    ...(document.lastAssignedAt === undefined ? {} : { lastAssignedAt: document.lastAssignedAt }),
    ...(document.idleSince === undefined ? {} : { idleSince: document.idleSince }),
    lastLocation: fromGeoJson(document.lastLocation),
    lastLocationAt: document.lastLocationAt,
  };
}

export function toMarketDocument(market: MarketLocation): MarketDocument {
  return { _id: market.marketId, location: toGeoJson(market.location) };
}
