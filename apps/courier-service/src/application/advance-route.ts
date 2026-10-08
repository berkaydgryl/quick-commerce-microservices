/**
 * Use-case: bir rotayi bu ana getirir (T13.3; tick'in tek rota adimi).
 *
 * Konum zamandan hesaplanir (route-progress.ts); burada yalnizca kilometre
 * taslari BIR KEZ kaydedilir ve olayi yayinlanir:
 *
 *   1. Kurye artik bu siparisi tasimiyorsa ve teslimat kaydedilmediyse
 *      (siparis iptal, kurye yeniden atandi) rota ENDED: ilerlemez, olay yok.
 *   2. Alma ani geldiyse pickedUpAt kaydedilir; courier.picked_up yayinlanir ve
 *      "yayinlandi" isaretlenir. T13.3 oncesi rotada (market yok) olay atlanir:
 *      courier.delivered tek basina iki gecisi yaptirir (contracts events.ts).
 *   3. Varis ani geldiyse deliveredAt kaydedilir; kurye TESLIMAT NOKTASINDA
 *      bosa cikar, courier.delivered yayinlanir, rota DONE. Teslim ani kayitli
 *      alma anindan once yazilmaz (#190, deliveredNoEarlierThan). #195'ten beri
 *      ikinci bacak kayitli almadan hesaplandigi icin bu yalnizca savunmadir.
 *   4. Ilerliyorsa kuryenin canli konumu yazilir (kisa omurlu).
 *
 * Her adim kosulludur ve tekrar guvenlidir: yayin dustuyse sonraki tur ayni
 * adimi tekrarlar (isaret yayindan SONRA yazilir: en az bir kez). Rota bu
 * arada yeniden atamayla degistiyse yama tutmaz ve tur birakilir (STALE).
 *
 * Kurye kaydini cagiran verir (advance-routes.ts turun basinda TOPLU okur;
 * rota basina okuma yok).
 */

import type { Clock, Logger } from '@getir/core';

import { carriesOrder } from '../domain/courier.js';
import type { Courier } from '../domain/courier.js';
import type { CourierRepository } from '../domain/courier-repository.js';
import type { LiveLocationStore } from '../domain/live-location.js';
import { deliveredNoEarlierThan, ROUTE_STATE } from '../domain/route.js';
import type { Route, RoutePatch } from '../domain/route.js';
import type { RouteEventPublisher } from '../domain/route-events.js';
import type { MovementRule } from '../domain/route-progress.js';
import { routeProgress } from '../domain/route-progress.js';
import type { MovingRouteRepository } from '../domain/route-repository.js';

/** Bir turun sonucu (ozet ve metrik). */
export const ADVANCE_OUTCOME = {
  MOVING: 'moving',
  PICKED_UP: 'picked_up',
  DELIVERED: 'delivered',
  ENDED: 'ended',
  STALE: 'stale',
} as const;

export type AdvanceOutcome = (typeof ADVANCE_OUTCOME)[keyof typeof ADVANCE_OUTCOME];

export interface AdvanceRouteDeps {
  readonly routes: MovingRouteRepository;
  readonly couriers: Pick<CourierRepository, 'releaseByOrder'>;
  readonly events: RouteEventPublisher;
  readonly live: LiveLocationStore;
  readonly rule: MovementRule;
  readonly clock: Clock;
}

/** `courier`: rotanin kuryesinin turun basindaki kaydi; yoksa null. */
export type AdvanceRoute = (
  route: Route,
  courier: Courier | null,
  logger: Logger,
) => Promise<AdvanceOutcome>;

/** Yamayi yazar; rota degistiyse ya da bittiyse null (tur birakilir). */
type Patch = (route: Route, patch: RoutePatch) => Promise<Route | null>;

export function createAdvanceRoute(deps: AdvanceRouteDeps): AdvanceRoute {
  const patch: Patch = (route, fields) => deps.routes.update(route, fields);

  return async (route, courier, logger) => {
    const now = deps.clock.date();
    const progress = routeProgress(route, now, deps.rule);
    const ids = { orderId: route.orderId, courierId: route.courierId };

    if (route.deliveredAt === undefined && !carriesOrder(courier, route.orderId)) {
      const ended = await patch(route, { state: ROUTE_STATE.ENDED, endedAt: now });
      if (ended !== null) {
        logger.info(ids, 'rota bitti: kurye siparisi artik tasimiyor');
      }
      return ended === null ? ADVANCE_OUTCOME.STALE : ADVANCE_OUTCOME.ENDED;
    }

    let current: Route | null = route;
    let outcome: AdvanceOutcome = ADVANCE_OUTCOME.MOVING;
    if (progress.pickedUpAt !== undefined && current.pickedUpAt === undefined) {
      current = await patch(current, { pickedUpAt: progress.pickedUpAt });
      outcome = ADVANCE_OUTCOME.PICKED_UP;
    }
    if (current?.pickedUpAt !== undefined && current.pickupPublished !== true) {
      current = await publishPickup(deps, patch, current, current.pickedUpAt, logger);
    }
    if (
      current !== null &&
      progress.deliveredAt !== undefined &&
      current.deliveredAt === undefined
    ) {
      current = await patch(current, {
        deliveredAt: deliveredNoEarlierThan(progress.deliveredAt, current.pickedUpAt),
      });
    }
    if (current?.deliveredAt !== undefined) {
      return (await completeDelivery(deps, patch, current, current.deliveredAt, logger)) === null
        ? ADVANCE_OUTCOME.STALE
        : ADVANCE_OUTCOME.DELIVERED;
    }
    if (current === null) {
      return ADVANCE_OUTCOME.STALE;
    }
    await deps.live.save(current.courierId, { location: progress.position, at: now });
    return outcome;
  };
}

async function publishPickup(
  deps: AdvanceRouteDeps,
  patch: Patch,
  route: Route,
  pickedUpAt: Date,
  logger: Logger,
): Promise<Route | null> {
  const { marketId } = route;
  if (marketId !== undefined) {
    await deps.events.pickedUp({ ...route, marketId }, pickedUpAt);
    logger.info(
      { orderId: route.orderId, courierId: route.courierId },
      'paket alindi; olay yayinlandi',
    );
  }
  return patch(route, { pickupPublished: true });
}

async function completeDelivery(
  deps: AdvanceRouteDeps,
  patch: Patch,
  route: Route,
  deliveredAt: Date,
  logger: Logger,
): Promise<Route | null> {
  const dropoff = route.points[route.points.length - 1];
  // Tekrar guvenli: kurye zaten birakildiysa null doner, konum degismez. Kurye
  // kimligiyle: rota bu arada baska kuryeye gectiyse o kurye BIRAKILMAZ.
  await deps.couriers.releaseByOrder(route.orderId, deliveredAt, {
    courierId: route.courierId,
    ...(dropoff === undefined ? {} : { location: dropoff }),
  });
  await deps.events.delivered(route, deliveredAt);
  const done = await patch(route, { deliveryPublished: true, state: ROUTE_STATE.DONE });
  if (done !== null) {
    logger.info(
      { orderId: route.orderId, courierId: route.courierId },
      'teslim edildi; olay yayinlandi',
    );
  }
  return done;
}
