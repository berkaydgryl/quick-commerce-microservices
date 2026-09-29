/**
 * Persona gecmisinin Mongo yazicisi (seed, T8.1): tek transaction'da sil ve yaz.
 */

import type { MongoConnection } from '@getir/mongo-kit';

import type { Order } from '../../domain/order.js';
import type { PersonaOrderWriter } from '../../domain/persona-order-writer.js';
import { toOrderDocument } from './mappers.js';
import type { OrdersCollection } from './orders-collection.js';

export class MongoPersonaOrderWriter implements PersonaOrderWriter {
  constructor(
    private readonly orders: OrdersCollection,
    private readonly transactions: Pick<MongoConnection, 'withTransaction'>,
  ) {}

  async replaceForUsers(userIds: readonly string[], orders: readonly Order[]): Promise<void> {
    await this.transactions.withTransaction(async (session) => {
      await this.orders.deleteByUsers(userIds, { session });
      await this.orders.insertMany(orders.map(toOrderDocument), { session });
    });
  }
}
