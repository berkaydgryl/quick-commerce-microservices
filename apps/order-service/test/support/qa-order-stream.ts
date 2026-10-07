/**
 * QA (T15.2, OQ1-OQ3): kumenin ortak akisindan okuma. Yayin EN AZ BIR KEZDIR (relay-outbox.ts);
 * tuketici eventId ile tekillestirir. Denetimler once tekillestirir (`uniqueEvents`, ilk gorulen
 * kalir); kopya sayisi ayrica olculur (`duplicates`).
 */

import { orderStatusChangedPayloadSchema } from '@getir/contracts';
import type { OrderStatusChangedPayload } from '@getir/contracts';
import { EVENTS } from '@getir/core';
import type { EventName } from '@getir/core';
import type { EventEnvelope } from '@getir/event-bus';

import type { Published } from './qa-order-cluster.js';

export function uniqueEvents(stream: readonly Published[]): EventEnvelope[] {
  const seen = new Set<string>();
  const unique: EventEnvelope[] = [];
  for (const { envelope } of stream) {
    if (seen.has(envelope.eventId)) continue;
    seen.add(envelope.eventId);
    unique.push(envelope);
  }
  return unique;
}

/** Akistaki tekrar sayisi (ayni eventId ikinci kez yayinlanmis). */
export function duplicates(stream: readonly Published[]): number {
  return stream.length - uniqueEvents(stream).length;
}

/** Siparisin durum gecisleri, akis sirasiyla, tekillestirilmis. Govde sozlesme disiysa firlatir. */
export function statusChanges(
  stream: readonly Published[],
  orderId: string,
): OrderStatusChangedPayload[] {
  return statusChangesOf(uniqueEvents(stream), orderId);
}

/** Akista GORULDUGU gibi (tekrarlar dahil) durum gecisleri: tuketicinin aldigi sira. */
export function rawStatusChanges(
  stream: readonly Published[],
  orderId: string,
): OrderStatusChangedPayload[] {
  return statusChangesOf(
    stream.map(({ envelope }) => envelope),
    orderId,
  );
}

function statusChangesOf(
  events: readonly EventEnvelope[],
  orderId: string,
): OrderStatusChangedPayload[] {
  return events
    .filter(
      (envelope) =>
        envelope.topic === EVENTS.ORDER_STATUS_CHANGED && envelope.partitionKey === orderId,
    )
    .map((envelope) => orderStatusChangedPayloadSchema.parse(envelope.payload));
}

/** Siparisin `topic` konulu (tekillestirilmis) olay sayisi. */
export function eventCount(
  stream: readonly Published[],
  orderId: string,
  topic: EventName,
): number {
  return uniqueEvents(stream).filter(
    (envelope) => envelope.topic === topic && envelope.partitionKey === orderId,
  ).length;
}
