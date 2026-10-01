/**
 * Olay hattinda korelasyon yardimcilari (D16): baglamdaki requestId, aktif
 * span'in traceparent'i ve traceparent'tan ust baglam. Saglayici gercek
 * (recordSpans: W3C yayici ve baglam yoneticisi kurulur).
 */

import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';

import { recordSpans } from '../../src/testing/spans.js';
import {
  activeRequestId,
  contextFromTraceparent,
  currentCorrelation,
  withRequestId,
} from '../../src/tracing/correlation.js';

recordSpans();

const REQUEST_ID = `req_${'3'.repeat(32)}`;
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_ID = '00f067aa0ba902b7';

describe('requestId baglamda', () => {
  it('konan kimlik okunur; konmamissa yok', () => {
    expect(activeRequestId(withRequestId(ROOT_CONTEXT, REQUEST_ID))).toBe(REQUEST_ID);
    expect(activeRequestId(ROOT_CONTEXT)).toBeUndefined();
  });

  it('aktif baglamdan okunur (context.with)', () => {
    const seen = context.with(withRequestId(ROOT_CONTEXT, REQUEST_ID), () => activeRequestId());

    expect(seen).toBe(REQUEST_ID);
  });
});

describe('currentCorrelation', () => {
  it("span icinde: requestId ve span'in W3C traceparent'i", () => {
    const span = trace.getTracer('test').startSpan('istek');
    const ctx = withRequestId(trace.setSpan(ROOT_CONTEXT, span), REQUEST_ID);

    const correlation = currentCorrelation(ctx);
    span.end();

    const { traceId, spanId } = span.spanContext();
    expect(correlation).toEqual({
      requestId: REQUEST_ID,
      traceparent: `00-${traceId}-${spanId}-01`,
    });
  });

  it('bicimsiz requestId (gateway disi cagri) tasinmaz; span yoksa traceparent yok', () => {
    expect(currentCorrelation(withRequestId(ROOT_CONTEXT, 'istek-1'))).toEqual({});
  });
});

describe('contextFromTraceparent', () => {
  it('gecerli baslik: ust span baglami (uzak)', () => {
    const parent = trace.getSpanContext(contextFromTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01`));

    expect(parent).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID, isRemote: true });
  });

  it('yok ya da bozuk: ust span yok (kok)', () => {
    expect(trace.getSpanContext(contextFromTraceparent(undefined))).toBeUndefined();
    expect(trace.getSpanContext(contextFromTraceparent('bozuk'))).toBeUndefined();
  });
});
