/**
 * RouteRepository'nin bellek uygulamasi (MOCK ve testler). Mongo uygulamasiyla
 * ayni sozlesme testinden gecer.
 */

import type { Route } from '../../domain/route.js';
import type { RouteRepository } from '../../domain/route-repository.js';

export class InMemoryRouteStore implements RouteRepository {
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
}
