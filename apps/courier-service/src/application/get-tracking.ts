/**
 * Use-case: siparisin takibi (T13.3; GetTracking). Degerler cagri ANINDA
 * rotadan hesaplanir (route-progress.ts) ve gizlilik kuraliyla gosterilir
 * (tracking-view.ts). Yalnizca BU siparisin saklanan rotasi kullanilir;
 * kuryenin baska siparisteki canli konumu kullanilmaz.
 *
 * NOT_FOUND: rota yok, rota birakildi (ENDED) ya da teslimattan once kurye
 * artik bu siparisi tasimiyor (iptal; tick henuz ENDED yazmadi). Sahiplik
 * (siparis kimin) cagirandadir: courier kullaniciyi bilmez.
 */

import type { Clock } from '@getir/core';
import { AppError } from '@getir/core';

import { carriesOrder } from '../domain/courier.js';
import type { CourierRepository } from '../domain/courier-repository.js';
import { ROUTE_STATE, routeState } from '../domain/route.js';
import type { MovementRule } from '../domain/route-progress.js';
import { routeProgress } from '../domain/route-progress.js';
import type { RouteRepository } from '../domain/route-repository.js';
import type { TrackingView } from '../domain/tracking-view.js';
import { trackingView } from '../domain/tracking-view.js';

/** Kurye kaydi bulunamazsa (or. seed yeniden yazildi) gosterilen ad. */
export const COURIER_FALLBACK_NAME = 'Kurye';

export interface OrderTracking extends TrackingView {
  readonly courierId: string;
  readonly courierName: string;
  /** Degerlerin hesaplandigi an. */
  readonly at: Date;
}

export interface GetTrackingDeps {
  readonly routes: Pick<RouteRepository, 'findByOrder'>;
  readonly couriers: Pick<CourierRepository, 'findById'>;
  readonly rule: MovementRule;
  readonly clock: Clock;
}

export type GetTracking = (orderId: string) => Promise<OrderTracking>;

export function createGetTracking(deps: GetTrackingDeps): GetTracking {
  const notFound = (orderId: string) =>
    AppError.notFound('Siparisin takibi yok', { details: { orderId } });

  return async (orderId) => {
    const route = await deps.routes.findByOrder(orderId);
    if (route === null || routeState(route) === ROUTE_STATE.ENDED) {
      throw notFound(orderId);
    }
    const courier = await deps.couriers.findById(route.courierId);
    const delivered = route.deliveredAt !== undefined || routeState(route) === ROUTE_STATE.DONE;
    if (!delivered && !carriesOrder(courier, route.orderId)) {
      throw notFound(orderId);
    }
    const at = deps.clock.date();
    return {
      ...trackingView(route, routeProgress(route, at, deps.rule)),
      courierId: route.courierId,
      courierName: courier?.name ?? COURIER_FALLBACK_NAME,
      at,
    };
  };
}
