/**
 * RouteRepository'nin Mongo uygulamasi. Sorgu yazmaz (routes-collection.ts);
 * bellek deposuyla ayni sozlesme testinden gecer.
 */

import { ROUTE_STATE } from '../../domain/route.js';
import type { Route, RoutePatch } from '../../domain/route.js';
import type { MovingRouteRepository, RouteRepository } from '../../domain/route-repository.js';
import { fromRouteDocument, routeProgressFields, toRouteDocument } from './mappers.js';
import type { RoutesCollection } from './routes-collection.js';

export class RouteMongoStore implements RouteRepository, MovingRouteRepository {
  constructor(private readonly routes: RoutesCollection) {}

  async findByOrder(orderId: string): Promise<Route | null> {
    const document = await this.routes.findById(orderId);
    return document === null ? null : fromRouteDocument(document);
  }

  async insertOnce(route: Route): Promise<Route> {
    return fromRouteDocument(await this.routes.insertOnce(toRouteDocument(route)));
  }

  async replace(route: Route): Promise<void> {
    await this.routes.replace(toRouteDocument(route));
  }

  async listMoving(limit: number): Promise<readonly Route[]> {
    return (await this.routes.findMoving(limit)).map(fromRouteDocument);
  }

  async update(route: Route, patch: RoutePatch): Promise<Route | null> {
    const document = toRouteDocument(route);
    // #177: ENDED yamasi teslim ani kayitli rotaya yazilmaz (kosul belgede).
    const updated = await this.routes.updateCurrent(document, routeProgressFields(patch), {
      requireUndelivered: patch.state === ROUTE_STATE.ENDED,
    });
    return updated === null ? null : fromRouteDocument(updated);
  }
}
