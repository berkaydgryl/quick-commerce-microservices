/**
 * OrderOutbox portunun Mongo uygulamasi (T7.3): yayinlanmamis olaylari okur,
 * isaretler ve siparis degismeden olay ekler. Sorgular outbox-collection.ts'te.
 */

import type { OrderEvent } from '../../domain/order-events.js';
import type { OrderOutbox } from '../../domain/order-outbox.js';
import type { OutboxCollection } from './outbox-collection.js';
import { fromOutboxDocument, toOutboxDocument } from './outbox-mappers.js';

export class MongoOrderOutbox implements OrderOutbox {
  constructor(private readonly outbox: OutboxCollection) {}

  async append(events: readonly OrderEvent[]): Promise<void> {
    await this.outbox.insertMany(events.map(toOutboxDocument));
  }

  async pending(limit: number): Promise<readonly OrderEvent[]> {
    return (await this.outbox.findUnpublished(limit)).map(fromOutboxDocument);
  }

  async markPublished(eventIds: readonly string[], at: Date): Promise<void> {
    await this.outbox.markPublished(eventIds, at);
  }
}
