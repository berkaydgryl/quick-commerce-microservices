/**
 * Iz saglayicisi (D15): OTLP/HTTP ile disari gonderme, surecte tek saglayici,
 * sinirli bosaltma, W3C yayici ve hata satirinin seyrekligi. Disari gonderilen
 * istekleri yakalayan yerel bir HTTP sunucusu Jaeger'in yerini tutar.
 */

import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { context, propagation, trace } from '@opentelemetry/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  OTLP_TRACES_PATH,
  startTracing,
  throttledErrorLog,
  TRACE_ERROR_LOG_INTERVAL_MS,
  TRACE_FLUSH_TIMEOUT_MS,
} from '../../src/tracing/provider.js';
import type { Tracing } from '../../src/tracing/provider.js';
import { startOtlpCollector } from '../../src/testing/otlp-collector.js';
import type { OtlpCollector } from '../../src/testing/otlp-collector.js';

const lines: LogLine[] = [];
let collector: OtlpCollector;
let tracing: Tracing;

beforeAll(async () => {
  collector = await startOtlpCollector();
  tracing = startTracing({
    serviceName: 'iz-deneme',
    otlpEndpoint: collector.url,
    logger: recordingLogger(lines),
  });
});

afterAll(async () => {
  await collector.close();
});

function endedSpan(name: string): void {
  trace.getTracer('test').startSpan(name).end();
}

describe('startTracing', () => {
  it('span OTLP/HTTP ile disari gider: yol /v1/traces, servis adi kaynakta', async () => {
    endedSpan('ilk-span');

    await tracing.flush();

    const request = collector.captured().find((entry) => entry.body.includes('ilk-span'));
    expect(request?.path).toBe(OTLP_TRACES_PATH);
    expect(request?.contentType).toContain('application/json');
    expect(request?.body).toContain('"iz-deneme"');
  });

  it('ikinci cagri ilk saglayiciyi kullanir (surecte tek saglayici)', async () => {
    const second = startTracing({ serviceName: 'baska-servis' });
    endedSpan('ikinci-span');

    await second.flush();

    const request = collector.captured().find((entry) => entry.body.includes('ikinci-span'));
    expect(request?.body).toContain('"iz-deneme"');
    expect(request?.body).not.toContain('baska-servis');
  });

  it("W3C yayici kurulu: aktif span traceparent'a yazilir", () => {
    const span = trace.getTracer('test').startSpan('yayilan');
    const carrier: Record<string, string> = {};

    propagation.inject(trace.setSpan(context.active(), span), carrier);
    span.end();

    const { traceId, spanId } = span.spanContext();
    expect(carrier['traceparent']).toBe(`00-${traceId}-${spanId}-01`);
  });

  it('toplayici cevap vermezse bosaltma en gec sure sinirinda biter, WARN yazilir', async () => {
    collector.hang(true);
    endedSpan('asili-span');

    const startedAt = Date.now();
    await tracing.flush();

    expect(Date.now() - startedAt).toBeLessThan(TRACE_FLUSH_TIMEOUT_MS + 1_000);
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 'warn', message: 'izler suresinde gonderilemedi' }),
    );
  });
});

describe('throttledErrorLog', () => {
  it('ilk hata yazilir; aralik dolana kadarkiler sayilip sonraki satirda bildirilir', () => {
    const errors: LogLine[] = [];
    let now = 1_000;
    const handle = throttledErrorLog(recordingLogger(errors), () => now);

    handle(new Error('bir'));
    handle(new Error('iki'));
    now += TRACE_ERROR_LOG_INTERVAL_MS - 1;
    handle(new Error('uc'));
    now += 1;
    handle(new Error('dort'));

    expect(errors.map((line) => line.fields['suppressed'])).toEqual([0, 2]);
    expect(errors.every((line) => line.level === 'warn')).toBe(true);
  });
});
