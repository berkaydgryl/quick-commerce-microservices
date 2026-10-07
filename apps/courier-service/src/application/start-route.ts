/**
 * Use-case: siparisin rotasini baslatir (T13.2, karar K a). Rotayi atama
 * uretir ve saklar (assignment-route.ts); kurye atandigi anda markete yurur.
 * StartRoute ayni rotayi `alreadyStarted = true` ile DONER: yeni rota uretmez,
 * tekrar guvenli bir okumadir (proto StartRouteResponse yorumu). Konum akisi
 * ve kalan sure T13.3'te.
 *
 * Siparisin bu kuryeyle CANLI rotasi yoksa NOT_FOUND: ya atama yok, ya siparis
 * baska kuryede, ya da kurye siparisi birakti (QA B1). Rota belgesi gecmis
 * olarak kalir; kurye BUSY ve siparisi tasiyorsa rota canlidir.
 */

import { AppError } from '@getir/core';
import type { Logger } from '@getir/core';

import { carriesOrder } from '../domain/courier.js';
import type { CourierRepository } from '../domain/courier-repository.js';
import type { Route } from '../domain/route.js';
import type { RouteRepository } from '../domain/route-repository.js';

export interface StartRouteCommand {
  readonly orderId: string;
  readonly courierId: string;
}

export interface StartedRoute {
  readonly route: Route;
  /** Rotanin basladigi an: atama ani. */
  readonly startedAt: Date;
  /** Rota bu cagridan once (atamada) baslamisti: hep true. */
  readonly alreadyStarted: boolean;
}

export type StartRoute = (command: StartRouteCommand, logger: Logger) => Promise<StartedRoute>;

export function createStartRoute(
  routes: RouteRepository,
  couriers: Pick<CourierRepository, 'findById'>,
): StartRoute {
  const notFound = (command: StartRouteCommand) =>
    AppError.notFound('Bu kuryenin bu siparis icin rotasi yok', {
      details: { orderId: command.orderId, courierId: command.courierId },
    });

  return async (command, logger) => {
    const route = await routes.findByOrder(command.orderId);
    if (route === null || route.courierId !== command.courierId) {
      throw notFound(command);
    }
    const courier = await couriers.findById(command.courierId);
    if (!carriesOrder(courier, command.orderId)) {
      throw notFound(command);
    }
    logger.debug({ orderId: route.orderId, courierId: route.courierId }, 'rota okundu');
    return { route, startedAt: route.createdAt, alreadyStarted: true };
  };
}
