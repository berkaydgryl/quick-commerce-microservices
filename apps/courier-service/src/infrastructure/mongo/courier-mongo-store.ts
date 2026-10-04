/**
 * CourierRepository'nin Mongo uygulamasi. Sorgu yazmaz (couriers-collection.ts);
 * bellek deposuyla ayni sozlesme testinden gecer.
 */

import type { Courier } from '../../domain/courier.js';
import type { ClaimRequest, CourierRepository } from '../../domain/courier-repository.js';
import type { CouriersCollection } from './couriers-collection.js';
import type { CourierDocument } from './documents.js';
import { fromCourierDocument } from './mappers.js';

const toCourier = (document: CourierDocument | null): Courier | null =>
  document === null ? null : fromCourierDocument(document);

export class CourierMongoStore implements CourierRepository {
  constructor(private readonly couriers: CouriersCollection) {}

  async findById(id: string): Promise<Courier | null> {
    return toCourier(await this.couriers.findById(id));
  }

  async findByOrder(orderId: string): Promise<Courier | null> {
    return toCourier(await this.couriers.findByOrder(orderId));
  }

  async claimLeastRecentlyAssigned(request: ClaimRequest): Promise<Courier | null> {
    return toCourier(await this.couriers.claimLeastRecentlyAssigned(request));
  }

  async releaseByOrder(orderId: string): Promise<Courier | null> {
    return toCourier(await this.couriers.releaseByOrder(orderId));
  }
}
