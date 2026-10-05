/**
 * RouteRepository'nin Mongo uygulamasi. Sorgu yazmaz (routes-collection.ts);
 * bellek deposuyla ayni sozlesme testinden gecer.
 */

import type { Route } from '../../domain/route.js';
import type { RouteRepository } from '../../domain/route-repository.js';
import { fromRouteDocument, toRouteDocument } from './mappers.js';
import type { RoutesCollection } from './routes-collection.js';

export class RouteMongoStore implements RouteRepository {
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
}
