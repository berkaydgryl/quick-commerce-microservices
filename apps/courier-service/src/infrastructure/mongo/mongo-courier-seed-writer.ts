/**
 * Seed'in yazicisi: couriers ve markets koleksiyonlarini TEK transaction'da
 * bastan yazar. Yarida kalan seed eski ile yeni verinin karisimini birakmaz.
 */

import type { MongoDatabase } from '@getir/mongo-kit';

import type { Courier } from '../../domain/courier.js';
import type { CourierSeedWriter } from '../../domain/courier-repository.js';
import type { MarketLocation } from '../../domain/market-locator.js';
import type { CouriersCollection } from './couriers-collection.js';
import { toCourierDocument, toMarketDocument } from './mappers.js';
import type { MarketsCollection } from './markets-collection.js';

export class MongoCourierSeedWriter implements CourierSeedWriter {
  constructor(
    private readonly database: MongoDatabase,
    private readonly couriers: CouriersCollection,
    private readonly markets: MarketsCollection,
  ) {}

  async replaceAll(
    couriers: readonly Courier[],
    markets: readonly MarketLocation[],
  ): Promise<void> {
    const courierDocuments = couriers.map(toCourierDocument);
    const marketDocuments = markets.map(toMarketDocument);
    await this.database.withTransaction(async (session) => {
      await this.couriers.replaceAll(courierDocuments, { session });
      await this.markets.replaceAll(marketDocuments, { session });
    });
  }
}
