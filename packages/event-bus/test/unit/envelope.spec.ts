/**
 * Olay zarfi ve Redis Streams alan cevirisi: saf, ag yok.
 */

import { AppError, EVENTS, ID_PREFIX, newId } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { eventEnvelopeSchema, validCorrelation } from '../../src/envelope.js';
import type { EventEnvelope } from '../../src/envelope.js';
import { InMemoryEventPublisher } from '../../src/in-memory-publisher.js';
import { fromStreamFields, peekEnvelope, toStreamFields } from '../../src/stream-fields.js';

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

const REQUEST_ID = `req_${'a'.repeat(32)}` as const;
const TRACEPARENT = `00-${'b'.repeat(32)}-${'c'.repeat(16)}-01`;

describe('zarfta korelasyon (D16)', () => {
  it('istege bagli requestId ve traceparent kabul edilir; yoklugu da gecerli', () => {
    expect(
      eventEnvelopeSchema.safeParse(envelope({ requestId: REQUEST_ID, traceparent: TRACEPARENT }))
        .success,
    ).toBe(true);
    expect(eventEnvelopeSchema.safeParse(envelope()).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['req_ onekli olmayan istek kimligi', { requestId: 'istek-1' }],
    ['kisa istek kimligi', { requestId: 'req_abc' }],
    ['W3C olmayan traceparent', { traceparent: 'bozuk' }],
    ['surumu 00 olmayan traceparent', { traceparent: `01-${'b'.repeat(32)}-${'c'.repeat(16)}-01` }],
  ])('sema reddeder: %s', (_name, overrides) => {
    expect(eventEnvelopeSchema.safeParse({ ...envelope(), ...overrides }).success).toBe(false);
  });

  it('validCorrelation gecerliyi tutar, bicimsizi atar (yayin durmasin)', () => {
    expect(validCorrelation({ requestId: REQUEST_ID, traceparent: TRACEPARENT })).toEqual({
      requestId: REQUEST_ID,
      traceparent: TRACEPARENT,
    });
    expect(validCorrelation({ requestId: 'istek-1', traceparent: TRACEPARENT })).toEqual({
      traceparent: TRACEPARENT,
    });
    expect(validCorrelation({ requestId: REQUEST_ID, traceparent: 'bozuk' })).toEqual({
      requestId: REQUEST_ID,
    });
    expect(validCorrelation({})).toEqual({});
  });

  it('korelasyon alanlari kayda yazilir ve birebir geri okunur', () => {
    const original = envelope({ requestId: REQUEST_ID, traceparent: TRACEPARENT });

    const fields = toStreamFields(original);

    expect(fields.filter((_, index) => index % 2 === 0)).toEqual([
      'eventId',
      'topic',
      'partitionKey',
      'occurredAt',
      'payload',
      'requestId',
      'traceparent',
    ]);
    expect(fromStreamFields(fields)).toEqual(original);
    expect(peekEnvelope(fields).requestId).toBe(REQUEST_ID);
  });

  it('kayittaki bicimsiz korelasyon alani atilir, olay yine okunur (olu olaya gitmez)', () => {
    const original = envelope();
    const fields = [...toStreamFields(original), 'requestId', 'istek-1', 'traceparent', 'bozuk'];

    expect(fromStreamFields(fields)).toEqual(original);
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

  it('peekEnvelope kimlik ve konuya DOGRULAMADAN bakar (govdesi bozuk kayitta da)', () => {
    const original = envelope();
    const fields = toStreamFields(original);
    fields[9] = '{bozuk json';

    expect(peekEnvelope(fields)).toEqual({ eventId: original.eventId, topic: original.topic });
    expect(peekEnvelope([])).toEqual({ eventId: undefined, topic: undefined });
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
