/**
 * Use-case: siparisin takibi (T13.3; GetTracking). Degerler cagri ANINDA
 * rotadan hesaplanir (route-progress.ts) ve gizlilik kuraliyla gosterilir
 * (tracking-view.ts). Yalnizca BU siparisin saklanan rotasi kullanilir;
 * kuryenin baska siparisteki canli konumu kullanilmaz.
 *
 * NOT_FOUND: rota yok, rota birakildi (ENDED) ya da teslimattan once kurye
 * artik bu siparisi tasimiyor (iptal; tick henuz ENDED yazmadi). Sahiplik
 * (siparis kimin) cagirandadir: courier kullaniciyi bilmez.
 *
 * TESLIM ANI YARISI: tick once deliveredAt'i yazar, SONRA kuryeyi birakir. Rota
 * ile kurye okumasi arasina teslim duserse kurye birakilmis, rota teslimsiz
 * gorunur; o zaman rota BIR KEZ yeniden okunur (teslim yazilmissa DELIVERED).
 * Web 404'te yoklamayi biraktigi icin teslimi hic gormezdi.
 */

import type { Clock } from '@getir/core';
import { AppError } from '@getir/core';

import { carriesOrder } from '../domain/courier.js';
import type { Courier } from '../domain/courier.js';
import type { CourierRepository } from '../domain/courier-repository.js';
import {
  belongsToAssignment,
  deliveredMeanwhile,
  isDelivered,
  ROUTE_STATE,
  routeState,
} from '../domain/route.js';
import type { Route } from '../domain/route.js';
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
    const first = await deps.routes.findByOrder(orderId);
    if (first === null || routeState(first) === ROUTE_STATE.ENDED) {
      throw notFound(orderId);
    }
    const courier = await deps.couriers.findById(first.courierId);
    const route = await trackedRoute(first, courier, () => deps.routes.findByOrder(orderId));
    if (route === null) {
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

/**
 * Takip edilecek rota; yoksa null (NOT_FOUND):
 *   - teslim kaydedildiyse rota (kurye artik baska iste olabilir);
 *   - kurye siparisi tasiyorsa ve rota BU atamanin rotasiysa rota (kurye ayni
 *     siparisi yeniden aldiysa eski rota, yenisi yazilana kadar gosterilmez);
 *   - aksi halde TESLIM ANI YARISI: rota BIR KEZ yeniden okunur; AYNI rota
 *     (kurye + uretilme ani), birakilmamis ve teslimi yazilmissa o.
 */
async function trackedRoute(
  first: Route,
  courier: Courier | null,
  reread: () => Promise<Route | null>,
): Promise<Route | null> {
  if (isDelivered(first)) {
    return first;
  }
  if (carriesOrder(courier, first.orderId)) {
    return belongsToAssignment(first, courier) ? first : null;
  }
  const again = await reread();
  return deliveredMeanwhile(first, again) ? again : null;
}
