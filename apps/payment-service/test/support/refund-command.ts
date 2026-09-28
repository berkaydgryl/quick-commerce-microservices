/**
 * Siparis saga'sinin outbox'a yazdigi iade komutunun aynisi (order
 * refundRequestedEvent, T7.3). Govde sozlesme tipinden kurulur; override ile
 * bozuk govde denenir.
 */

import type { RefundRequestedPayload } from '@getir/contracts';
import { EVENTS, ID_PREFIX, newId } from '@getir/core';
import type { EventEnvelope } from '@getir/event-bus';

export function refundCommand(
  orderId: string,
  at: Date,
  override: Record<string, unknown> = {},
): EventEnvelope {
  const payload: RefundRequestedPayload = {
    orderId,
    reason: 'order_changed_during_payment',
    idempotencyKey: `refund-${orderId}`,
  };
  return {
    eventId: newId(ID_PREFIX.EVENT),
    topic: EVENTS.PAYMENT_REFUND_REQUESTED,
    partitionKey: orderId,
    occurredAt: at.toISOString(),
    payload: { ...payload, ...override },
  };
}
