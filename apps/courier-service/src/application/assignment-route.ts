/**
 * Atamanin rotasi (T13.2): kuryenin atama anindaki konumu -> market -> teslimat
 * adresi (domain/route-planner.ts). Siparisin rotasi varsa O doner; yoksa
 * uretilir ve BIR KEZ yazilir. Tekrar istek ve eszamanli ikinci istek ayni
 * rotayi, ayni varis tahminini gorur.
 *
 * Kurye rota boyunca Mongo'da hareket etmez (canli konum T13.3, Redis): rota
 * yazilmadan once atama dussa da (depo hatasi) tekrar istek ayni konumdan ayni
 * rotayi uretir. Siparis yeniden atandiysa (birakma sonrasi, baska ya da AYNI
 * kuryeye; QA B2) eski rota yenisiyle degistirilir: saklanan rota kuryenin son
 * atamasindan eskiyse o atamanin degildir. Siparis basina yine tek belge.
 *
 * Market kopyada yoksa rota uretilemez: atama yine doner (kurye siparise
 * bagli), varis tahmini "hesaplanmadi" kalir ve WARN yazilir.
 */

import type { Clock, Logger } from '@getir/core';

import type { Courier, GeoPoint } from '../domain/courier.js';
import type { MarketLocator } from '../domain/market-locator.js';
import type { Route } from '../domain/route.js';
import { planRoute } from '../domain/route-planner.js';
import type { RouteRule } from '../domain/route-planner.js';
import type { RouteRepository } from '../domain/route-repository.js';

export interface AssignmentRouteRequest {
  readonly orderId: string;
  /** Siparisi tasiyan kurye (yeni atanmis ya da tekrar istekte var olan). */
  readonly courier: Courier;
  readonly marketId: string;
  readonly deliveryLocation: GeoPoint;
  /** Atama marketi zaten bulduysa tekrar okunmaz. */
  readonly marketLocation?: GeoPoint;
}

export type AssignmentRoute = (
  request: AssignmentRouteRequest,
  logger: Logger,
) => Promise<Route | null>;

export interface AssignmentRouteDeps {
  readonly routes: RouteRepository;
  readonly markets: MarketLocator;
  readonly rule: RouteRule;
  readonly clock: Clock;
}

export function createAssignmentRoute(deps: AssignmentRouteDeps): AssignmentRoute {
  return async (request, logger) => {
    const stored = await deps.routes.findByOrder(request.orderId);
    if (stored !== null && belongsToAssignment(stored, request.courier)) {
      return stored;
    }
    const pickup = request.marketLocation ?? (await deps.markets.locate(request.marketId));
    if (pickup === null) {
      logger.warn(
        { orderId: request.orderId, marketId: request.marketId },
        'rota uretilemedi: market konumu bilinmiyor',
      );
      return null;
    }
    const route: Route = {
      orderId: request.orderId,
      courierId: request.courier.id,
      ...planRoute(
        { from: request.courier.lastLocation, pickup, dropoff: request.deliveryLocation },
        deps.rule,
      ),
      createdAt: deps.clock.date(),
    };
    if (stored === null) {
      return deps.routes.insertOnce(route);
    }
    await deps.routes.replace(route);
    logger.info(
      { orderId: request.orderId, courierId: route.courierId, previousCourierId: stored.courierId },
      'siparis yeniden atandi; rota yenilendi',
    );
    return route;
  };
}

/** Saklanan rota kuryenin bu atamasinin mi: ayni kurye, son atamadan once uretilmemis. */
function belongsToAssignment(route: Route, courier: Courier): boolean {
  if (route.courierId !== courier.id) {
    return false;
  }
  return (
    courier.lastAssignedAt === undefined ||
    route.createdAt.getTime() >= courier.lastAssignedAt.getTime()
  );
}
