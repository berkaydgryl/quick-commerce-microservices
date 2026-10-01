/**
 * Olay hattinda korelasyon (D16), order tarafi: gercek gRPC handler'i -> use-case
 * -> outbox -> yayin. Saglayici gercek (recordSpans): handler'in sunucu span'i,
 * outbox satirindaki iz ve yayinin PRODUCER span'i ayni izde mi?
 *
 * Saglayici surecte tektir; bu yuzden ayri dosya (vitest dosya basina surec).
 */

import {
  AppError,
  ERROR_CODES,
  EVENTS,
  ORDER_STATUS,
  silentLogger,
  systemClock,
} from '@getir/core';
import { InMemoryEventPublisher } from '@getir/event-bus';
import { recordSpans, SpanKind } from '@getir/observability/testing';
import type { ReadableSpan } from '@getir/observability/testing';
import { orderV1 } from '@getir/proto';
import { Metadata } from '@grpc/grpc-js';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRelayOutbox } from '../../src/application/relay-outbox.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import { FakePayments } from '../support/fake-payments.js';
import { useOrderGrpcServer } from '../support/order-grpc-harness.js';
import { createOrderRequest, draftRequest } from '../support/order-fixtures.js';

const spans = recordSpans();

const INCOMING_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const INCOMING_SPAN_ID = '00f067aa0ba902b7';

const store = new InMemoryOrderStore();
const payments = new FakePayments();
const call = useOrderGrpcServer({
  payments,
  store: { repository: store, history: store, outbox: store },
});

beforeEach(async () => {
  spans.reset();
  // Onceki testin olaylari bu testin gozlemini karistirmasin.
  const leftover = await store.pending(1_000);
  await store.markPublished(
    leftover.map((event) => event.eventId),
    new Date(),
  );
});

/** Gateway'in gonderdigi gibi: istek kimligi ve W3C iz basligi. */
function requestMetadata(requestId: string): Metadata {
  const metadata = new Metadata();
  metadata.set('x-request-id', requestId);
  metadata.set('traceparent', `00-${INCOMING_TRACE_ID}-${INCOMING_SPAN_ID}-01`);
  return metadata;
}

function serverSpan(rpc: string): ReadableSpan {
  const found = spans
    .finished()
    .filter((span) => span.kind === SpanKind.SERVER && span.name.endsWith(`/${rpc}`));
  expect(found).toHaveLength(1);
  return found[0] as ReadableSpan;
}

const traceparentOf = (span: ReadableSpan) =>
  `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`;

async function relayAll(publisher: InMemoryEventPublisher): Promise<void> {
  await createRelayOutbox({ outbox: store, publisher, clock: systemClock, batchSize: 100 })(
    silentLogger,
  );
}

describe('outbox korelasyonu (D16)', () => {
  it("gRPC isteginin olayi istegin requestId'sini ve sunucu span'inin baglamini tasir; yayin onun cocugu", async () => {
    const requestId = `req_${'1'.repeat(32)}`;

    const { response } = await call(
      orderV1.OrderServiceService.createDraftOrder,
      { ...draftRequest, idempotencyKey: 'korelasyon-taslak-1' },
      requestMetadata(requestId),
    );

    const server = serverSpan('CreateDraftOrder');
    const [pending] = await store.pending(10);
    expect(pending?.orderId).toBe(response?.orderId);
    expect(pending?.correlation).toEqual({ requestId, traceparent: traceparentOf(server) });

    const publisher = new InMemoryEventPublisher();
    await relayAll(publisher);

    const producer = spans.finished().find((span) => span.kind === SpanKind.PRODUCER);
    expect(producer?.name).toBe('publish order.created');
    expect(producer?.spanContext().traceId).toBe(INCOMING_TRACE_ID);
    expect(producer?.parentSpanContext?.spanId).toBe(server.spanContext().spanId);
    // Hatta giden zarf yayin span'ini tasir: tuketici onun cocugu olur.
    expect(publisher.published[0]).toMatchObject({
      topic: EVENTS.ORDER_CREATED,
      requestId,
      traceparent: producer === undefined ? 'yok' : traceparentOf(producer),
    });
  });

  it('telafi komutu (payment.refund_requested) da istegin izini tasir', async () => {
    const requestId = `req_${'2'.repeat(32)}`;
    const { response } = await call(orderV1.OrderServiceService.createDraftOrder, {
      ...draftRequest,
      idempotencyKey: 'korelasyon-taslak-2',
    });
    const orderId = response?.orderId ?? '';
    // Cekim surerken kullanici iptal eder (siparis PAID yazilamaz) ve dogrudan iade
    // de basarisiz olur: iade komutu outbox'a yazilir (T7.3).
    payments.beforeChargeReturns = async () => {
      const current = await store.findById(orderId);
      if (current === null) throw new Error('siparis yok');
      await store.update(
        transitionOrder(current, ORDER_STATUS.CANCELLED, systemClock, 'USER_CANCELLED'),
        current.version,
        [],
      );
    };
    payments.refundFailure = new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'payment kapali');
    spans.reset();

    const result = await call(
      orderV1.OrderServiceService.createOrder,
      createOrderRequest(orderId, { idempotencyKey: 'korelasyon-odeme-2' }),
      requestMetadata(requestId),
    );

    expect(result.error?.code).toBeDefined();
    const server = serverSpan('CreateOrder');
    const command = (await store.pending(100)).find(
      (event) => event.topic === EVENTS.PAYMENT_REFUND_REQUESTED,
    );
    expect(command?.payload['orderId']).toBe(orderId);
    expect(command?.correlation).toEqual({ requestId, traceparent: traceparentOf(server) });
  });
});
