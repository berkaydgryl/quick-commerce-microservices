/**
 * RouteRepository'nin bellek uygulamasi (MOCK ve testler). Mongo uygulamasiyla
 * ayni sozlesme testinden gecer.
 */

import { ROUTE_STATE, routeState } from '../../domain/route.js';
import type { Route, RoutePatch } from '../../domain/route.js';
import type { MovingRouteRepository, RouteRepository } from '../../domain/route-repository.js';

export class InMemoryRouteStore implements RouteRepository, MovingRouteRepository {
  private readonly routes = new Map<string, Route>();

  findByOrder(orderId: string): Promise<Route | null> {
    return Promise.resolve(this.routes.get(orderId) ?? null);
  }

  insertOnce(route: Route): Promise<Route> {
    const existing = this.routes.get(route.orderId);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    this.routes.set(route.orderId, route);
    return Promise.resolve(route);
  }

  replace(route: Route): Promise<void> {
    this.routes.set(route.orderId, route);
    return Promise.resolve();
  }

  /** Bitmemis rotalar; durum alani olmayan (T13.3 oncesi) rota da ilerliyor sayilir. */
  listMoving(limit: number): Promise<readonly Route[]> {
    const moving = [...this.routes.values()]
      .filter((route) => routeState(route) === ROUTE_STATE.MOVING)
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          (left.orderId < right.orderId ? -1 : 1),
      );
    return Promise.resolve(moving.slice(0, limit));
  }

  update(route: Route, patch: RoutePatch): Promise<Route | null> {
    const stored = this.routes.get(route.orderId);
    if (
      stored === undefined ||
      stored.courierId !== route.courierId ||
      stored.createdAt.getTime() !== route.createdAt.getTime() ||
      routeState(stored) !== ROUTE_STATE.MOVING ||
      (patch.state === ROUTE_STATE.ENDED && stored.deliveredAt !== undefined)
    ) {
      return Promise.resolve(null);
    }
    const updated: Route = { ...stored, ...patch };
    this.routes.set(route.orderId, updated);
    return Promise.resolve(updated);
  }
}
