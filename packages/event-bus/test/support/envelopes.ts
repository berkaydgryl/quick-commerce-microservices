/** Testlerin ortak zarf ve akis kaydi ureticileri. */

import { EVENTS, ID_PREFIX, newId } from '@getir/core';

import type { StreamEntry } from '../../src/dispatch.js';
import type { EventEnvelope } from '../../src/envelope.js';
import { toStreamFields } from '../../src/stream-fields.js';

export function envelopeOf(
  topic: EventEnvelope['topic'] = EVENTS.PAYMENT_REFUND_REQUESTED,
  payload: Record<string, unknown> = { orderId: 'ord_1' },
): EventEnvelope {
  return {
    eventId: newId(ID_PREFIX.EVENT),
    topic,
    partitionKey: typeof payload['orderId'] === 'string' ? payload['orderId'] : 'ord_1',
    occurredAt: '2026-09-28T10:00:00.000Z',
    payload,
  };
}

export function entryOf(id: string, envelope: EventEnvelope = envelopeOf()): StreamEntry {
  return { id, fields: toStreamFields(envelope) };
}
