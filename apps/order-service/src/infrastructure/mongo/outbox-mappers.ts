/**
 * Olay <-> outbox belgesi cevirisi (T7.3). Yazan istegin izi (D16) belgede iki
 * istege bagli alandir; okunurken olayin yanina `correlation` olarak doner.
 */

import type { OrderEvent } from '../../domain/order-events.js';
import type { EventCorrelation, PendingEvent } from '../../domain/order-outbox.js';
import type { OutboxDocument } from './documents.js';

/** Yeni satir: yayinlanmamis (publishedAt null). */
export function toOutboxDocument(event: OrderEvent, correlation: EventCorrelation): OutboxDocument {
  return {
    _id: event.eventId,
    topic: event.topic,
    aggregateId: event.orderId,
    version: event.version,
    occurredAt: event.occurredAt,
    payload: { ...event.payload },
    publishedAt: null,
    ...(correlation.requestId === undefined ? {} : { requestId: correlation.requestId }),
    ...(correlation.traceparent === undefined ? {} : { traceparent: correlation.traceparent }),
  };
}

export function fromOutboxDocument(document: OutboxDocument): PendingEvent {
  const correlation: EventCorrelation = {
    ...(document.requestId === undefined ? {} : { requestId: document.requestId }),
    ...(document.traceparent === undefined ? {} : { traceparent: document.traceparent }),
  };
  return {
    eventId: document._id,
    topic: document.topic,
    orderId: document.aggregateId,
    version: document.version,
    occurredAt: document.occurredAt,
    payload: document.payload,
    ...(Object.keys(correlation).length === 0 ? {} : { correlation }),
  };
}
