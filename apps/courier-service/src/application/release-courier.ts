/**
 * Use-case: siparisi tasiyan kuryeyi bosa cikarir (BUSY -> IDLE).
 *
 * TEKRAR GUVENLIDIR: siparisi tasiyan kurye yoksa (zaten birakildi ya da hic
 * atanmadi) hata degil "birakilmadi" doner. Order, atamadan sonra siparisi
 * yazamazsa (bu arada iptal edildi) kuryeyi bununla geri verir.
 *
 * Kurye oldugu yerde IDLE kalir (havuz, T13.2): konumu degismez, bosta
 * beklemesi birakma aninda baslar (idleSince; #88). Yoldaki anlik konumda
 * birakma bekleyen is #174.
 *
 * Rota (T13.3, karar M6 a): birakilan kuryenin ilerleyen rotasi burada ENDED
 * yazilir; tick'i beklemez, olay yayinlanmaz. Yazilamazsa kurye yine birakilmis
 * sayilir: tick rotayi kuryenin artik tasimadigini gorup bitirir.
 */

import type { Clock, Logger } from '@getir/core';

import type { CourierRepository } from '../domain/courier-repository.js';
import { ROUTE_STATE, routeState } from '../domain/route.js';
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
  readonly couriers: Pick<CourierRepository, 'releaseByOrder'>;
  /** Verilmezse rota tick'te biter. */
  readonly routes?: EndableRoutes;
  readonly clock: Clock;
}

export function createReleaseCourier(deps: ReleaseCourierDeps): ReleaseCourier {
  return async (orderId, logger) => {
    const at = deps.clock.date();
    const released = await deps.couriers.releaseByOrder(orderId, at);
    if (released === null) {
      logger.info({ orderId }, 'birakilacak kurye yok (zaten birakilmis ya da atanmamis)');
      return { released: false };
    }
    logger.info({ orderId, courierId: released.id }, 'kurye birakildi');
    if (deps.routes !== undefined) {
      await endRoute(deps.routes, { orderId, courierId: released.id, at }, logger);
    }
    return { released: true, courierId: released.id };
  };
}

/** Bu kuryenin ilerleyen rotasini ENDED yazar; hata birakmayi bozmaz. */
async function endRoute(
  routes: EndableRoutes,
  released: { readonly orderId: string; readonly courierId: string; readonly at: Date },
  logger: Logger,
): Promise<void> {
  try {
    const route = await routes.findByOrder(released.orderId);
    if (
      route === null ||
      route.courierId !== released.courierId ||
      route.deliveredAt !== undefined ||
      routeState(route) !== ROUTE_STATE.MOVING
    ) {
      return;
    }
    await routes.update(route, { state: ROUTE_STATE.ENDED, endedAt: released.at });
  } catch (error: unknown) {
    logger.warn(
      { err: error, orderId: released.orderId, courierId: released.courierId },
      'rota bitirilemedi; tick bitirecek',
    );
  }
}
