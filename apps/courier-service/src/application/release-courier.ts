/**
 * Use-case: siparisi tasiyan kuryeyi bosa cikarir (BUSY -> IDLE).
 *
 * TEKRAR GUVENLIDIR: siparisi tasiyan kurye yoksa (zaten birakildi ya da hic
 * atanmadi) hata degil "birakilmadi" doner. Order, atamadan sonra siparisi
 * yazamazsa (bu arada iptal edildi) kuryeyi bununla geri verir.
 *
 * IPTAL ILE TESLIM YARISI (#177): tek sonuc kalir. Karar ROTA belgesindedir:
 *   - teslim ani kaydedildiyse (tick yazdi) TESLIM kazanmistir: kurye burada
 *     birakilmaz; tick onu teslimat noktasinda birakir ve courier.delivered
 *     yayinlar (takip DELIVERED);
 *   - degilse rota once KOSULLU olarak ENDED yazilir (depo teslim ani kayitli
 *     rotaya ENDED yazmaz). Yazildiysa IPTAL kazanmistir: tick'in teslim yamasi
 *     tutmaz, olay yayinlanmaz; kurye o anki konumunda bosa cikar.
 *
 * KONUM (#174): kurye birakma aninda rotasindaki HESAPLANAN konumda IDLE olur
 * (routeProgress; rotanin kendi kurali, #197): atandigi yere "isinlanmaz".
 * Rotasi olmayan (market konumu bilinmeyen) atamada konum degismez.
 *
 * Birakma yazimi kurye kimligi ve siparisle kosulludur ({_id, currentOrderId},
 * _id indeksi): arada kurye degistiyse kimse birakilmaz.
 */

import type { Clock, Logger } from '@getir/core';

import type { Courier, GeoPoint } from '../domain/courier.js';
import type { CourierRepository } from '../domain/courier-repository.js';
import {
  belongsToAssignment,
  deliveredMeanwhile,
  isDelivered,
  ROUTE_STATE,
  routeState,
  sameRoute,
} from '../domain/route.js';
import type { Route } from '../domain/route.js';
import type { MovementRule } from '../domain/route-progress.js';
import { courierLocation, routeProgress } from '../domain/route-progress.js';
import type { MovingRouteRepository, RouteRepository } from '../domain/route-repository.js';

export interface CourierRelease {
  readonly released: boolean;
  /** Birakilan kurye; released = false ise yok. */
  readonly courierId?: string;
}

export type ReleaseCourier = (orderId: string, logger: Logger) => Promise<CourierRelease>;

/** Rotayi bitirebilen depo: okuma (siparisle) ve kosullu yama. */
export type EndableRoutes = Pick<RouteRepository, 'findByOrder'> &
  Pick<MovingRouteRepository, 'update'>;

export interface ReleaseCourierDeps {
  readonly couriers: Pick<CourierRepository, 'findByOrder' | 'releaseByOrder'>;
  /** Verilmezse rota tick'te biter ve kurye konumu degismez. */
  readonly routes?: EndableRoutes;
  /** #197 oncesi (kuralsiz) rotanin o anki hareket kurali. */
  readonly rule: MovementRule;
  readonly clock: Clock;
}

const NOT_RELEASED: CourierRelease = { released: false };

export function createReleaseCourier(deps: ReleaseCourierDeps): ReleaseCourier {
  return async (orderId, logger) => {
    const at = deps.clock.date();
    const carrier = await deps.couriers.findByOrder(orderId);
    if (carrier === null) {
      logger.info({ orderId }, 'birakilacak kurye yok (zaten birakilmis ya da atanmamis)');
      return NOT_RELEASED;
    }
    const ids = { orderId, courierId: carrier.id };
    const decision = await routeDecision(deps, orderId, carrier, at);
    if (decision.kind === 'delivered') {
      logger.info(ids, 'teslim kaydedilmis: kurye birakilmaz, tick teslimat noktasinda birakir');
      return NOT_RELEASED;
    }
    const released = await deps.couriers.releaseByOrder(orderId, at, {
      courierId: carrier.id,
      ...(decision.location === undefined ? {} : { location: decision.location }),
    });
    if (released === null) {
      logger.info(ids, 'kurye bu arada degisti ya da birakildi; birakilmadi');
      return NOT_RELEASED;
    }
    logger.info(ids, 'kurye birakildi');
    return { released: true, courierId: released.id };
  };
}

type RouteDecision =
  { readonly kind: 'delivered' } | { readonly kind: 'cancelled'; readonly location?: GeoPoint };

/**
 * Kuryenin bu atamasinin rotasina gore karar. Rota yoksa (ya da baska
 * atamanin) iptal, konum degismez. Rota okunamaz ya da yazilamazsa HATA
 * doner (kurye birakilmaz): kor birakma teslimle birlikte iki sonuc
 * uretebilirdi; cagri tekrar guvenlidir (order'in istemcisi yeniden dener).
 */
async function routeDecision(
  deps: ReleaseCourierDeps,
  orderId: string,
  carrier: Courier,
  at: Date,
): Promise<RouteDecision> {
  if (deps.routes === undefined) {
    return { kind: 'cancelled' };
  }
  const route = await deps.routes.findByOrder(orderId);
  return route === null || !belongsToAssignment(route, carrier)
    ? { kind: 'cancelled' }
    : endRoute(deps.routes, route, at, deps.rule);
}

/**
 * Iptalin rota adimi. Teslim kayitliysa teslim kazanir. Degilse ENDED kosullu
 * yazilir: tutarsa iptal kazanir ve kurye rotadaki hesaplanan konumunda
 * birakilir; tutmazsa rota yeniden okunur (teslim araya girdiyse teslim kazanir).
 * Rota zaten ENDED ise (onceki deneme yazdi, birakma dustu) kurye o anin
 * konumunda birakilir.
 */
async function endRoute(
  routes: EndableRoutes,
  route: Route,
  at: Date,
  rule: MovementRule,
): Promise<RouteDecision> {
  if (isDelivered(route)) {
    return { kind: 'delivered' };
  }
  if (routeState(route) !== ROUTE_STATE.MOVING) {
    return endedDecision(route, rule);
  }
  const ended = await routes.update(route, { state: ROUTE_STATE.ENDED, endedAt: at });
  if (ended !== null) {
    return { kind: 'cancelled', location: positionAt(route, at, rule) };
  }
  const again = await routes.findByOrder(route.orderId);
  if (deliveredMeanwhile(route, again)) {
    return { kind: 'delivered' };
  }
  return again !== null && sameRoute(again, route)
    ? endedDecision(again, rule)
    : { kind: 'cancelled' };
}

/** Bitmis (ENDED) rota: kurye bitis anindaki konumda; an yoksa konum degismez. */
function endedDecision(route: Route, rule: MovementRule): RouteDecision {
  return route.endedAt === undefined
    ? { kind: 'cancelled' }
    : { kind: 'cancelled', location: positionAt(route, route.endedAt, rule) };
}

/** Kuryenin `at`'teki yazilacak konumu (rotanin kurali, #197; market kurali). */
function positionAt(route: Route, at: Date, rule: MovementRule): GeoPoint {
  return courierLocation(route, routeProgress(route, at, rule));
}
