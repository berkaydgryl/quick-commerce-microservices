/**
 * Order'in outbox'a yazdigi iptal komutunun aynisi (order statusChangedEvents,
 * T11.2 PR 3). Govde sozlesme tipinden kurulur; override ile bozuk govde denenir.
 */

import type { PaymentCancelRequestedPayload } from '@getir/contracts';
import { EVENTS, ID_PREFIX, newId } from '@getir/core';
import type { EventEnvelope } from '@getir/event-bus';

export function cancelCommand(
  orderId: string,
  at: Date,
  override: Record<string, unknown> = {},
): EventEnvelope {
  const payload: PaymentCancelRequestedPayload = { orderId, reason: 'order_cancelled' };
  return {
    eventId: newId(ID_PREFIX.EVENT),
    topic: EVENTS.PAYMENT_CANCEL_REQUESTED,
    partitionKey: orderId,
    occurredAt: at.toISOString(),
    payload: { ...payload, ...override },
  };
}
