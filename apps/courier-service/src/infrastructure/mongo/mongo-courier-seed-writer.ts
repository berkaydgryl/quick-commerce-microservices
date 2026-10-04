/**
 * Seed'in yazicisi: couriers koleksiyonunu TEK transaction'da bastan yazar.
 * Yarida kalan seed eski ile yeni kuryelerin karisimini birakmaz.
 */

import type { MongoDatabase } from '@getir/mongo-kit';

import type { Courier } from '../../domain/courier.js';
import type { CourierSeedWriter } from '../../domain/courier-repository.js';
import type { CouriersCollection } from './couriers-collection.js';
import { toCourierDocument } from './mappers.js';

export class MongoCourierSeedWriter implements CourierSeedWriter {
  constructor(
    private readonly database: MongoDatabase,
    private readonly couriers: CouriersCollection,
  ) {}

  async replaceAll(couriers: readonly Courier[]): Promise<void> {
    const documents = couriers.map(toCourierDocument);
    await this.database.withTransaction(async (session) => {
      await this.couriers.replaceAll(documents, { session });
    });
  }
}
