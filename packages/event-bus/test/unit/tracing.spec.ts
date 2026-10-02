/**
 * Olay hattinda iz (D16): yayin (PRODUCER) ve isleme (CONSUMER) span'leri, zarfta
 * tasinan baglam ve requestId. Saglayici gercek (recordSpans); ag yok.
 *
 * Saglayici surecte tektir; bu yuzden ayri dosya (vitest dosya basina surec).
 */

import { AppError, ERROR_CODES, EVENTS, silentLogger } from '@getir/core';
import { activeRequestId } from '@getir/observability';
import { recordSpans, SpanKind, SpanStatusCode } from '@getir/observability/testing';
import type { ReadableSpan } from '@getir/observability/testing';
import type { RedisConnection } from '@getir/redis-kit';
import { context, trace } from '@opentelemetry/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchEntry } from '../../src/dispatch.js';
import type { DispatchContext } from '../../src/dispatch.js';
import type { EventEnvelope } from '../../src/envelope.js';
import { InMemoryEventPublisher } from '../../src/in-memory-publisher.js';
import { RedisStreamsPublisher } from '../../src/redis-streams-publisher.js';
import { EVENT_HANDLED, rejectEvent } from '../../src/subscriber.js';
import type { EventHandler } from '../../src/subscriber.js';
import { MESSAGING_ATTRIBUTES } from '../../src/tracing.js';
import { entryOf, envelopeOf } from '../support/envelopes.js';

const spans = recordSpans();

const REQUEST_ID = `req_${'5'.repeat(32)}` as const;
const UPSTREAM_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const UPSTREAM_SPAN_ID = '00f067aa0ba902b7';
const UPSTREAM = `00-${UPSTREAM_TRACE_ID}-${UPSTREAM_SPAN_ID}-01`;

beforeEach(() => {
  spans.reset();
});

function only(kind: SpanKind): ReadableSpan {
  const found = spans.finished().filter((span) => span.kind === kind);
  expect(found).toHaveLength(1);
  return found[0] as ReadableSpan;
}

const traceparentOf = (span: ReadableSpan) =>
  `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`;

const correlated = (): EventEnvelope => ({
  ...envelopeOf(),
  requestId: REQUEST_ID,
  traceparent: UPSTREAM,
});

describe('yayin: PRODUCER span (D16)', () => {
  it("ust span zarftaki traceparent; hatta giden zarf yayin span'ini tasir", async () => {
    const publisher = new InMemoryEventPublisher();
    const envelope = correlated();

    await publisher.publish(envelope);

    const producer = only(SpanKind.PRODUCER);
    expect(producer.name).toBe('publish payment.refund_requested');
    expect(producer.spanContext().traceId).toBe(UPSTREAM_TRACE_ID);
    expect(producer.parentSpanContext?.spanId).toBe(UPSTREAM_SPAN_ID);
    expect(producer.attributes).toEqual({
      [MESSAGING_ATTRIBUTES.SYSTEM]: 'memory',
      [MESSAGING_ATTRIBUTES.OPERATION]: 'send',
      [MESSAGING_ATTRIBUTES.DESTINATION]: EVENTS.PAYMENT_REFUND_REQUESTED,
      [MESSAGING_ATTRIBUTES.MESSAGE_ID]: envelope.eventId,
      [MESSAGING_ATTRIBUTES.REQUEST_ID]: REQUEST_ID,
    });
    expect(publisher.published[0]).toEqual({ ...envelope, traceparent: traceparentOf(producer) });
  });

  it('zarfta baglam yoksa aktif span ust olur', async () => {
    const publisher = new InMemoryEventPublisher();
    const parent = trace.getTracer('test').startSpan('istek');

    await context.with(trace.setSpan(context.active(), parent), () =>
      publisher.publish(envelopeOf()),
    );
    parent.end();

    const producer = only(SpanKind.PRODUCER);
    expect(producer.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(publisher.published[0]?.traceparent).toBe(traceparentOf(producer));
  });

  it('yazim basarisizsa span ERROR ve istisna kaydedilir; hata cagirana doner', async () => {
    const redis = {
      xadd: () => Promise.reject(new Error('redis kapali')),
    } as unknown as RedisConnection['redis'];

    await expect(new RedisStreamsPublisher(redis).publish(correlated())).rejects.toThrow(
      'redis kapali',
    );

    const producer = only(SpanKind.PRODUCER);
    expect(producer.status.code).toBe(SpanStatusCode.ERROR);
    expect(producer.attributes[MESSAGING_ATTRIBUTES.SYSTEM]).toBe('redis');
    expect(producer.events.map((event) => event.name)).toEqual(['exception']);
  });
});

describe('isleme: CONSUMER span (D16)', () => {
  function contextFor(
    handler: EventHandler,
    overrides: Partial<DispatchContext> = {},
  ): DispatchContext {
    return {
      attempt: 1,
      maxDeliveries: 3,
      handlerFor: (topic) => (topic === EVENTS.PAYMENT_REFUND_REQUESTED ? handler : undefined),
      group: 'payment',
      logger: silentLogger,
      ...overrides,
    };
  }

  const handled = (): EventHandler => vi.fn<EventHandler>(() => Promise.resolve(EVENT_HANDLED));

  it("ust span zarftaki traceparent; isleyici span'in ve requestId'nin baglaminda kosar", async () => {
    const seen: { spanId?: string | undefined; requestId?: string | undefined } = {};
    const handler: EventHandler = () => {
      seen.spanId = trace.getActiveSpan()?.spanContext().spanId;
      seen.requestId = activeRequestId();
      return Promise.resolve(EVENT_HANDLED);
    };
    const envelope = correlated();

    await dispatchEntry(entryOf('1-0', envelope), contextFor(handler, { attempt: 2 }));

    const consumer = only(SpanKind.CONSUMER);
    expect(consumer.name).toBe('process payment.refund_requested');
    expect(consumer.spanContext().traceId).toBe(UPSTREAM_TRACE_ID);
    expect(consumer.parentSpanContext?.spanId).toBe(UPSTREAM_SPAN_ID);
    expect(consumer.status.code).toBe(SpanStatusCode.UNSET);
    expect(consumer.attributes).toEqual({
      [MESSAGING_ATTRIBUTES.SYSTEM]: 'redis',
      [MESSAGING_ATTRIBUTES.OPERATION]: 'process',
      [MESSAGING_ATTRIBUTES.DESTINATION]: EVENTS.PAYMENT_REFUND_REQUESTED,
      [MESSAGING_ATTRIBUTES.MESSAGE_ID]: envelope.eventId,
      [MESSAGING_ATTRIBUTES.CONSUMER_GROUP]: 'payment',
      [MESSAGING_ATTRIBUTES.DELIVERY_ATTEMPT]: 2,
      [MESSAGING_ATTRIBUTES.REQUEST_ID]: REQUEST_ID,
    });
    expect(seen).toEqual({ spanId: consumer.spanContext().spanId, requestId: REQUEST_ID });
  });

  it('baglamsiz zarf (eski kayit): yeni iz, uretilen requestId span ve baglamda', async () => {
    let requestId: string | undefined;
    const handler: EventHandler = () => {
      requestId = activeRequestId();
      return Promise.resolve(EVENT_HANDLED);
    };

    await dispatchEntry(entryOf('1-0'), contextFor(handler));

    const consumer = only(SpanKind.CONSUMER);
    expect(consumer.parentSpanContext).toBeUndefined();
    expect(requestId).toMatch(/^req_[0-9a-f]{32}$/);
    expect(consumer.attributes[MESSAGING_ATTRIBUTES.REQUEST_ID]).toBe(requestId);
  });

  it('kalici ret: ERROR "reddedildi", sebebin kodu ve istisnasi span\'de', async () => {
    const handler: EventHandler = () =>
      Promise.resolve(
        rejectEvent('iade yapilamaz', new AppError(ERROR_CODES.NOT_FOUND, 'odeme yok')),
      );

    await dispatchEntry(entryOf('1-0', correlated()), contextFor(handler));

    const consumer = only(SpanKind.CONSUMER);
    expect(consumer.status).toEqual({ code: SpanStatusCode.ERROR, message: 'reddedildi' });
    expect(consumer.attributes[MESSAGING_ATTRIBUTES.ERROR_CODE]).toBe(ERROR_CODES.NOT_FOUND);
    expect(consumer.events.map((event) => event.name)).toEqual(['exception']);
  });

  it('gecici hata: ERROR "islenemedi" ve istisna; her teslim ayri span', async () => {
    const handler: EventHandler = () => Promise.reject(new Error('veritabani kapali'));

    await dispatchEntry(entryOf('1-0', correlated()), contextFor(handler, { attempt: 1 }));
    await dispatchEntry(entryOf('1-0', correlated()), contextFor(handler, { attempt: 2 }));

    const consumers = spans.finished().filter((span) => span.kind === SpanKind.CONSUMER);
    expect(consumers.map((span) => span.attributes[MESSAGING_ATTRIBUTES.DELIVERY_ATTEMPT])).toEqual(
      [1, 2],
    );
    expect(consumers.every((span) => span.status.code === SpanStatusCode.ERROR)).toBe(true);
    expect(consumers.every((span) => span.parentSpanContext?.spanId === UPSTREAM_SPAN_ID)).toBe(
      true,
    );
  });

  it('grubun dinlemedigi konu ve hakki bitmis kayit span acmaz (isleyiciye verilmedi)', async () => {
    await dispatchEntry(
      entryOf('1-0', { ...envelopeOf(EVENTS.ORDER_CREATED), traceparent: UPSTREAM }),
      contextFor(handled()),
    );
    await dispatchEntry(entryOf('2-0', correlated()), contextFor(handled(), { attempt: 4 }));

    expect(spans.finished()).toEqual([]);
  });
});
