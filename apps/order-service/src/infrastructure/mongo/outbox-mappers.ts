/**
 * Olay <-> outbox belgesi cevirisi (T7.3).
 */

import type { OrderEvent } from '../../domain/order-events.js';
import type { OutboxDocument } from './documents.js';

/** Yeni satir: yayinlanmamis (publishedAt null). */
export function toOutboxDocument(event: OrderEvent): OutboxDocument {
  return {
    _id: event.eventId,
    topic: event.topic,
    aggregateId: event.orderId,
    version: event.version,
    occurredAt: event.occurredAt,
    payload: { ...event.payload },
    publishedAt: null,
  };
}

export function fromOutboxDocument(document: OutboxDocument): OrderEvent {
  return {
    eventId: document._id,
    topic: document.topic,
    orderId: document.aggregateId,
    version: document.version,
    occurredAt: document.occurredAt,
    payload: document.payload,
  };
}
