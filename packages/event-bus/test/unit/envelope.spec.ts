/**
 * Olay zarfi ve Redis Streams alan cevirisi: saf, ag yok.
 */

import { AppError, EVENTS, ID_PREFIX, newId } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { eventEnvelopeSchema } from '../../src/envelope.js';
import type { EventEnvelope } from '../../src/envelope.js';
import { InMemoryEventPublisher } from '../../src/in-memory-publisher.js';
import { fromStreamFields, toStreamFields } from '../../src/stream-fields.js';

const envelope = (overrides: Partial<EventEnvelope> = {}): EventEnvelope => ({
  eventId: newId(ID_PREFIX.EVENT),
  topic: EVENTS.ORDER_STATUS_CHANGED,
  partitionKey: 'ord_db77f4c0e24f49919cc1d78a649c9c94',
  occurredAt: '2026-09-28T10:00:00.000Z',
  payload: { orderId: 'ord_db77f4c0e24f49919cc1d78a649c9c94', from: 'DRAFT', to: 'RISK_CHECK' },
  ...overrides,
});

describe('eventEnvelopeSchema', () => {
  it('gecerli zarfi kabul eder', () => {
    expect(eventEnvelopeSchema.safeParse(envelope()).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['evt_ onekli olmayan kimlik', { eventId: 'ord_db77f4c0e24f49919cc1d78a649c9c94' }],
    ['sozlukte olmayan konu', { topic: 'order.bilinmeyen' }],
    ['bos bolum anahtari', { partitionKey: '' }],
    ['ISO olmayan zaman', { occurredAt: '28.09.2026' }],
  ])('reddeder: %s', (_name, overrides) => {
    expect(eventEnvelopeSchema.safeParse({ ...envelope(), ...overrides }).success).toBe(false);
  });
});

describe('toStreamFields / fromStreamFields', () => {
  it('zarf stream kaydina ve geri birebir doner (payload JSON)', () => {
    const original = envelope();

    const fields = toStreamFields(original);

    expect(fields.filter((_, index) => index % 2 === 0)).toEqual([
      'eventId',
      'topic',
      'partitionKey',
      'occurredAt',
      'payload',
    ]);
    expect(fromStreamFields(fields)).toEqual(original);
  });

  it('bozuk kayit sessizce gecmez: INTERNAL', () => {
    const fields = toStreamFields(envelope());
    fields[9] = '{bozuk json';

    expect(() => fromStreamFields(fields)).toThrow(AppError);
  });
});

describe('InMemoryEventPublisher', () => {
  it('yayinlananlari sirasiyla tutar', async () => {
    const publisher = new InMemoryEventPublisher();
    const first = envelope();
    const second = envelope({ topic: EVENTS.ORDER_CREATED });

    await publisher.publish(first);
    await publisher.publish(second);

    expect(publisher.published).toEqual([first, second]);
  });
});
