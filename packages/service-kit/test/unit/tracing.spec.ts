/**
 * gRPC izleri (D15): sunucu span'i (unaryHandler) ve istemci span'i (callUnary).
 * Bellek ici saglayici HER SEYDEN ONCE kurulur; startGrpcServer'in kurdugu
 * saglayici bu olur (surecte tek saglayici).
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { recordSpans } from '@getir/observability/testing';
import type { ReadableSpan } from '@getir/observability/testing';
import { Metadata } from '@grpc/grpc-js';
import type { MethodDefinition, ServerUnaryCall } from '@grpc/grpc-js';
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BOOM_MESSAGE,
  createEchoImplementation,
  echoServiceDefinition,
} from '../../src/example/echo-service.js';
import { unaryHandler } from '../../src/grpc/handler.js';
import { healthServiceDefinition } from '../../src/grpc/health.js';
import { SPAN_ATTRIBUTES } from '../../src/grpc/tracing.js';
import { callUnary } from '../../src/grpc/unary-call.js';
import { startTestGrpcServer } from '../../src/testing/index.js';
import type { TestGrpcServer } from '../../src/testing/index.js';

const spans = recordSpans();

const RESERVE_PATH = '/getir.test.v1.StockService/Reserve';
const INCOMING_TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const INCOMING_SPAN_ID = 'b7ad6b7169203331';
const schema = z.object({ sku: z.string() });

const servers: TestGrpcServer[] = [];

beforeEach(() => {
  spans.reset();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop('test bitti')));
});

function fakeCall(metadata: Metadata): ServerUnaryCall<unknown, unknown> {
  return {
    request: { sku: 'SUT-1L' },
    metadata,
    getPath: () => RESERVE_PATH,
  } as unknown as ServerUnaryCall<unknown, unknown>;
}

function invoke(handle: () => unknown, metadata = new Metadata()): Promise<void> {
  const handler = unaryHandler({ name: 'Reserve', schema, handle });
  return new Promise((resolve) => {
    handler(fakeCall(metadata), () => {
      resolve();
    });
  });
}

function withTraceparent(): Metadata {
  const metadata = new Metadata();
  metadata.set('traceparent', `00-${INCOMING_TRACE_ID}-${INCOMING_SPAN_ID}-01`);
  metadata.set('x-request-id', 'req_izli');
  return metadata;
}

function only(kind: SpanKind): ReadableSpan {
  const matching = spans.finished().filter((span) => span.kind === kind);
  expect(matching).toHaveLength(1);
  return matching[0] as ReadableSpan;
}

describe("unaryHandler: sunucu span'i (D15)", () => {
  it("gelen traceparent'in cocugu; ad tam metot, rpc nitelikleri ve requestId", async () => {
    await invoke(() => ({ ok: true }), withTraceparent());

    const span = only(SpanKind.SERVER);
    expect(span.name).toBe('getir.test.v1.StockService/Reserve');
    expect(span.spanContext().traceId).toBe(INCOMING_TRACE_ID);
    expect(span.parentSpanContext?.spanId).toBe(INCOMING_SPAN_ID);
    expect(span.attributes).toMatchObject({
      [SPAN_ATTRIBUTES.RPC_SYSTEM]: 'grpc',
      [SPAN_ATTRIBUTES.RPC_SERVICE]: 'getir.test.v1.StockService',
      [SPAN_ATTRIBUTES.RPC_METHOD]: 'Reserve',
      [SPAN_ATTRIBUTES.RPC_STATUS]: 0,
      [SPAN_ATTRIBUTES.REQUEST_ID]: 'req_izli',
    });
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('traceparent yoksa yeni iz baslar (ust span yok)', async () => {
    await invoke(() => ({ ok: true }));

    const span = only(SpanKind.SERVER);
    expect(span.parentSpanContext).toBeUndefined();
    expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it.each([
    [
      'beklenen is sonucu',
      () => new AppError(ERROR_CODES.STOCK_INSUFFICIENT, 'yok'),
      SpanStatusCode.UNSET,
      0,
    ],
    [
      'siradisi',
      () => new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'yok'),
      SpanStatusCode.ERROR,
      0,
    ],
    ['beklenmeyen', () => new TypeError('bozuk'), SpanStatusCode.ERROR, 1],
  ])(
    '%s: hata isareti agirliktan, istisna yalnizca beklenmeyende',
    async (_case, make, status, events) => {
      await invoke(() => {
        throw make();
      });

      const span = only(SpanKind.SERVER);
      expect(span.status.code).toBe(status);
      expect(span.events.filter((event) => event.name === 'exception')).toHaveLength(events);
      expect(span.attributes[SPAN_ATTRIBUTES.ERROR_CODE]).toBeDefined();
    },
  );

  it("handler span icinde kosar: aktif span sunucu span'idir", async () => {
    let active: string | undefined;
    await invoke(() => {
      active = trace.getActiveSpan()?.spanContext().spanId;
      return { ok: true };
    });

    expect(active).toBe(only(SpanKind.SERVER).spanContext().spanId);
  });
});

describe("callUnary: istemci span'i ve traceparent (D15)", () => {
  const echo = (echoServiceDefinition as Record<string, MethodDefinition<unknown, unknown>>)[
    'Echo'
  ] as MethodDefinition<unknown, unknown>;

  async function startEcho(): Promise<TestGrpcServer> {
    const server = await startTestGrpcServer({
      services: [
        { definition: echoServiceDefinition, implementation: createEchoImplementation('b') },
      ],
    });
    servers.push(server);
    return server;
  }

  function callEcho(server: TestGrpcServer, message: string): Promise<unknown> {
    return callUnary<unknown, unknown>(
      (request, metadata, options, callback) =>
        server.client.makeUnaryRequest(
          echo.path,
          echo.requestSerialize,
          echo.responseDeserialize,
          request,
          metadata,
          options,
          callback,
        ),
      { message, repeat: 1 },
      { requestId: 'req_istemci', timeoutMs: 2_000 },
    );
  }

  it("ust span -> istemci span'i -> karsi servisin sunucu span'i: tek iz", async () => {
    const server = await startEcho();
    const parent = trace.getTracer('test').startSpan('ust');

    await context.with(trace.setSpan(context.active(), parent), () => callEcho(server, 'merhaba'));
    parent.end();

    const client = only(SpanKind.CLIENT);
    const remote = only(SpanKind.SERVER);
    const traceId = parent.spanContext().traceId;
    expect(client.name).toBe('getir.example.v1.EchoService/Echo');
    expect(client.spanContext().traceId).toBe(traceId);
    expect(client.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(remote.spanContext().traceId).toBe(traceId);
    expect(remote.parentSpanContext?.spanId).toBe(client.spanContext().spanId);
    expect(remote.attributes[SPAN_ATTRIBUTES.REQUEST_ID]).toBe('req_istemci');
    expect(client.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("karsi taraf beklenmeyen hata donerse istemci span'i ERROR ve hata kodu", async () => {
    const server = await startEcho();

    await expect(callEcho(server, BOOM_MESSAGE)).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });

    const client = only(SpanKind.CLIENT);
    expect(client.status.code).toBe(SpanStatusCode.ERROR);
    expect(client.attributes[SPAN_ATTRIBUTES.ERROR_CODE]).toBe(ERROR_CODES.INTERNAL);
    expect(client.attributes[SPAN_ATTRIBUTES.RPC_STATUS]).toBe(13);
  });

  it("karsi taraf beklenen is hatasi donerse istemci span'i hatali isaretlenmez", async () => {
    const server = await startEcho();

    await expect(callEcho(server, '')).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });

    const client = only(SpanKind.CLIENT);
    expect(client.status.code).toBe(SpanStatusCode.UNSET);
    expect(client.attributes[SPAN_ATTRIBUTES.ERROR_CODE]).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('saglik yoklamasi izlenmez (D15, ADR-20)', () => {
  const check = (healthServiceDefinition as Record<string, MethodDefinition<unknown, unknown>>)[
    'Check'
  ] as MethodDefinition<unknown, unknown>;

  it("Health.Check ne istemci ne sunucu span'i acar; ust span icinden cagrilsa da", async () => {
    const server = await startTestGrpcServer({ services: [] });
    servers.push(server);
    const parent = trace.getTracer('test').startSpan('ust');

    await context.with(trace.setSpan(context.active(), parent), () =>
      callUnary<unknown, unknown>(
        (request, metadata, options, callback) =>
          server.client.makeUnaryRequest(
            check.path,
            check.requestSerialize,
            check.responseDeserialize,
            request,
            metadata,
            options,
            callback,
          ),
        { service: '' },
        { requestId: 'req_saglik', timeoutMs: 2_000 },
      ),
    );
    parent.end();

    expect(spans.finished().map((span) => span.name)).toEqual(['ust']);
  });
});
