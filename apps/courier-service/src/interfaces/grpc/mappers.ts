/**
 * Domain -> sozlesme (proto) cevirisi. Durum eslemesi Record: yeni bir durum
 * eklendiginde eksik esleme DERLEMEDE yakalanir.
 */

import { courierV1 } from '@getir/proto';

import type { CourierRelease } from '../../application/release-courier.js';
import type { StartedRoute } from '../../application/start-route.js';
import { COURIER_STATUS } from '../../domain/courier.js';
import type { Courier, CourierStatus } from '../../domain/courier.js';

const STATUS_TO_PROTO: Readonly<Record<CourierStatus, courierV1.CourierStatus>> = {
  [COURIER_STATUS.IDLE]: courierV1.CourierStatus.COURIER_STATUS_IDLE,
  [COURIER_STATUS.BUSY]: courierV1.CourierStatus.COURIER_STATUS_BUSY,
  [COURIER_STATUS.OFFLINE]: courierV1.CourierStatus.COURIER_STATUS_OFFLINE,
};

export function toProtoCourier(courier: Courier): courierV1.Courier {
  return {
    id: courier.id,
    name: courier.name,
    // Kullanimdan kalkti (ADR-15): sunucu doldurmaz.
    darkStoreId: '',
    // Kurye markete bagli degil (T13.2, ortak havuz): sunucu doldurmaz.
    marketId: '',
    status: STATUS_TO_PROTO[courier.status],
    currentOrderId: courier.currentOrderId ?? '',
    lastLocation: { lat: courier.lastLocation.lat, lng: courier.lastLocation.lng },
    lastLocationAt: courier.lastLocationAt,
  };
}

export function toProtoRelease(release: CourierRelease): courierV1.ReleaseCourierResponse {
  return { released: release.released, courierId: release.courierId ?? '' };
}

export function toProtoStartedRoute(started: StartedRoute): courierV1.StartRouteResponse {
  return {
    route: {
      points: started.route.points.map((point) => ({ lat: point.lat, lng: point.lng })),
      distanceMeters: started.route.distanceMeters,
      etaSeconds: started.route.etaSeconds,
    },
    startedAt: started.startedAt,
    alreadyStarted: started.alreadyStarted,
  };
}
