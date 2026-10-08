/** Kurye ve market <-> belge cevirisi. Yok olan istege bagli alan iki yonde de HIC yazilmaz. */

import { z } from 'zod';

import type { Courier, GeoPoint } from '../../domain/courier.js';
import type { MarketLocation } from '../../domain/market-locator.js';
import type { Route } from '../../domain/route.js';
import type { CourierDocument, GeoJsonPoint, MarketDocument, RouteDocument } from './documents.js';

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

export function toRouteDocument(route: Route): RouteDocument {
  return {
    _id: route.orderId,
    courierId: route.courierId,
    points: route.points.map((point) => ({ lat: point.lat, lng: point.lng })),
    pickupIndex: route.pickupIndex,
    distanceMeters: route.distanceMeters,
    etaSeconds: route.etaSeconds,
    createdAt: route.createdAt,
    ...(route.movement === undefined
      ? {}
      : {
          movement: { speedKmh: route.movement.speedKmh, prepSeconds: route.movement.prepSeconds },
        }),
    ...routeProgressFields(route),
  };
}

/**
 * Belgedeki #197 hareket kurali; yoksa ya da gecersizse (null, eksik alan, hiz
 * 0 ya da negatif, sayi olmayan) YOK sayilir: rota o anki ayarla ilerler. Bozuk
 * tek belge hesabi (sonsuz/NaN) ya da tick partisini dusurmez.
 */
function storedMovement(value: unknown): Pick<Route, 'movement'> {
  const parsed = storedMovementSchema.safeParse(value);
  return parsed.success ? { movement: parsed.data } : {};
}

const storedMovementSchema = z.object({
  speedKmh: z.number().finite().positive(),
  prepSeconds: z.number().finite().min(0),
});

/** T13.3 alanlari: tanimsiz olan belgeye YAZILMAZ (Mongo'da null olmasin); tick yamasi da bundan. */
export function routeProgressFields(source: RouteProgressFields): RouteProgressFields {
  return {
    ...(source.marketId === undefined ? {} : { marketId: source.marketId }),
    ...(source.state === undefined ? {} : { state: source.state }),
    ...(source.pickedUpAt === undefined ? {} : { pickedUpAt: source.pickedUpAt }),
    ...(source.pickupPublished === undefined ? {} : { pickupPublished: source.pickupPublished }),
    ...(source.deliveredAt === undefined ? {} : { deliveredAt: source.deliveredAt }),
    ...(source.deliveryPublished === undefined
      ? {}
      : { deliveryPublished: source.deliveryPublished }),
    ...(source.endedAt === undefined ? {} : { endedAt: source.endedAt }),
  };
}

type RouteProgressFields = Pick<
  RouteDocument,
  | 'marketId'
  | 'state'
  | 'pickedUpAt'
  | 'pickupPublished'
  | 'deliveredAt'
  | 'deliveryPublished'
  | 'endedAt'
>;

export function fromRouteDocument(document: RouteDocument): Route {
  return {
    orderId: document._id,
    courierId: document.courierId,
    points: document.points.map((point) => ({ lat: point.lat, lng: point.lng })),
    pickupIndex: document.pickupIndex,
    distanceMeters: document.distanceMeters,
    etaSeconds: document.etaSeconds,
    createdAt: document.createdAt,
    ...storedMovement(document.movement),
    ...routeProgressFields(document),
  };
}
