/**
 * Olay hattinda iz gercek Redis'te (Testcontainers, D16): yayin -> akis ->
 * isleme TEK iz; isleyicinin baglami ve gunlugu olayi doguran istegin
 * requestId'sini tasir; olu olay kopyasi korelasyon alanlarini korur.
 *
 * Saglayici gercek (recordSpans); surecte tek oldugu icin ayri dosya.
 */

import { EVENTS } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { activeRequestId } from '@getir/observability';
import { recordSpans, SpanKind } from '@getir/observability/testing';
import type { ReadableSpan } from '@getir/observability/testing';
import { describe, expect, it } from 'vitest';

import type { EventEnvelope } from '../../src/envelope.js';
import { EVENT_HANDLED, rejectEvent } from '../../src/subscriber.js';
import {
  FAST_DELIVERY,
  GROUP,
  refundCommand,
  useRedisHarness,
  waitFor,
} from '../support/redis-harness.js';

const spans = recordSpans();
const redis = useRedisHarness();

const REQUEST_ID = `req_${'6'.repeat(32)}` as const;
const UPSTREAM_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const UPSTREAM_SPAN_ID = '00f067aa0ba902b7';

const correlatedCommand = (): EventEnvelope => ({
  ...refundCommand(),
  requestId: REQUEST_ID,
  traceparent: `00-${UPSTREAM_TRACE_ID}-${UPSTREAM_SPAN_ID}-01`,
});

function spansOf(kind: SpanKind): ReadableSpan[] {
  return spans.finished().filter((span) => span.kind === kind);
}

describe('olay hattinda iz (D16, gercek Redis)', () => {
  it("yayin -> akis -> isleme tek iz; isleyicinin baglami ve gunlugu istegin requestId'si", async () => {
    spans.reset();
    const streams = redis.freshStreams();
    const lines: LogLine[] = [];
    let seenRequestId: string | undefined;
    const consumer = redis.consumerOn(streams, 'tuketici-1', FAST_DELIVERY, recordingLogger(lines));
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, (_envelope, { logger }) => {
      seenRequestId = activeRequestId();
      logger.info({}, 'iade komutu islendi');
      return Promise.resolve(EVENT_HANDLED);
    });
    await redis.startAll(consumer);

    await redis.publish(streams, correlatedCommand());
    await waitFor(() => spansOf(SpanKind.CONSUMER).length === 1);

    const [producer] = spansOf(SpanKind.PRODUCER);
    const [processed] = spansOf(SpanKind.CONSUMER);
    expect(producer?.spanContext().traceId).toBe(UPSTREAM_TRACE_ID);
    expect(producer?.parentSpanContext?.spanId).toBe(UPSTREAM_SPAN_ID);
    expect(processed?.spanContext().traceId).toBe(UPSTREAM_TRACE_ID);
    expect(processed?.parentSpanContext?.spanId).toBe(producer?.spanContext().spanId);

    // Akistaki kayit yayin span'inin baglamini ve istegin kimligini tasir.
    const [[, fields] = ['', []]] = await redis.admin().redis.xrange(streams.streamKey, '-', '+');
    const record = new Map<string, string>();
    for (let index = 0; index + 1 < fields.length; index += 2) {
      record.set(fields[index] ?? '', fields[index + 1] ?? '');
    }
    expect(record.get('requestId')).toBe(REQUEST_ID);
    expect(record.get('traceparent')).toBe(
      `00-${UPSTREAM_TRACE_ID}-${producer?.spanContext().spanId ?? ''}-01`,
    );

    expect(seenRequestId).toBe(REQUEST_ID);
    const line = lines.find((entry) => entry.message === 'iade komutu islendi');
    expect(line?.fields).toMatchObject({ requestId: REQUEST_ID, group: GROUP });
  });

  it('olu olay kopyasi korelasyon alanlarini korur (yeniden oynatilan olay ayni izde)', async () => {
    const streams = redis.freshStreams();
    const consumer = redis.consumerOn(streams);
    consumer.subscribe(EVENTS.PAYMENT_REFUND_REQUESTED, GROUP, () =>
      Promise.resolve(rejectEvent('iade yapilamaz')),
    );
    await redis.startAll(consumer);

    await redis.publish(streams, correlatedCommand());
    await waitFor(async () => (await redis.deadLetters(streams)).length === 1);

    const [dead] = await redis.deadLetters(streams);
    expect(dead?.get('requestId')).toBe(REQUEST_ID);
    expect(dead?.get('traceparent')).toMatch(
      new RegExp(`^00-${UPSTREAM_TRACE_ID}-[0-9a-f]{16}-01$`),
    );
  });
});
