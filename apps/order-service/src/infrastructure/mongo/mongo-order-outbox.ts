/**
 * OrderOutbox portunun Mongo uygulamasi (T7.3): yayinlanmamis olaylari okur,
 * isaretler ve siparis degismeden olay ekler. Sorgular outbox-collection.ts'te.
 * Eklenen olay, yazan istegin izini (D16) tasir.
 */

import { currentCorrelation } from '@getir/observability';

import type { OrderEvent } from '../../domain/order-events.js';
import type { CorrelationSource, OrderOutbox, PendingEvent } from '../../domain/order-outbox.js';
import type { OutboxCollection } from './outbox-collection.js';
import { fromOutboxDocument, toOutboxDocument } from './outbox-mappers.js';

export class MongoOrderOutbox implements OrderOutbox {
  constructor(
    private readonly outbox: OutboxCollection,
    private readonly correlation: CorrelationSource = currentCorrelation,
  ) {}

  async append(events: readonly OrderEvent[]): Promise<void> {
    const correlation = this.correlation();
    await this.outbox.insertMany(events.map((event) => toOutboxDocument(event, correlation)));
  }

  async pending(limit: number): Promise<readonly PendingEvent[]> {
    return (await this.outbox.findUnpublished(limit)).map(fromOutboxDocument);
  }

  async markPublished(eventIds: readonly string[], at: Date): Promise<void> {
    await this.outbox.markPublished(eventIds, at);
  }
}
