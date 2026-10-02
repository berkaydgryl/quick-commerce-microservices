/**
 * Olay hattinda iz (D16; ADR-20 ve ADR-07 eki): yayinda PRODUCER, islemede
 * CONSUMER span'i. Iz baglami zarfin `traceparent` alaninda tasinir; tuketicinin
 * span'i yayinin cocugu olur: istek -> outbox -> hat -> tuketici TEK izdir.
 *
 * YALNIZCA `@opentelemetry/api`: saglayici kurulmamissa span'ler bir sey yapmaz,
 * zarftaki baglam yine aynen tasinir.
 *
 * Nitelikler izin listelidir (ADR-20): sistem, islem, konu, olay kimligi, grup,
 * deneme, `app.request_id`, hatada `app.error_code`. Govde (payload) ize
 * YAZILMAZ: kisisel veri tasir.
 */

import { isAppError } from '@getir/core';
import { contextFromTraceparent, currentCorrelation, withRequestId } from '@getir/observability';
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Attributes, Context, Span } from '@opentelemetry/api';

import type { EventEnvelope } from './envelope.js';

/** Span'leri acan kutuphanenin adi (iz goruntuleyicide "instrumentation scope"). */
const TRACER_NAME = '@getir/event-bus';

/** Span nitelikleri: messaging.* OpenTelemetry anlam kurallarindan. */
export const MESSAGING_ATTRIBUTES = {
  SYSTEM: 'messaging.system',
  OPERATION: 'messaging.operation.type',
  DESTINATION: 'messaging.destination.name',
  MESSAGE_ID: 'messaging.message.id',
  CONSUMER_GROUP: 'messaging.consumer.group.name',
  DELIVERY_ATTEMPT: 'app.delivery_attempt',
  REQUEST_ID: 'app.request_id',
  ERROR_CODE: 'app.error_code',
} as const;

/** Tasima: Redis Streams (tuketim bugun yalnizca burada) ya da bellek ici yayinci. */
export const MESSAGING_SYSTEM = {
  REDIS: 'redis',
  MEMORY: 'memory',
} as const;

export type MessagingSystem = (typeof MESSAGING_SYSTEM)[keyof typeof MESSAGING_SYSTEM];

/** Saglayici sonradan kurulsa da (startGrpcServer) guncel izleyiciyi alir. */
function tracer() {
  return trace.getTracer(TRACER_NAME);
}

function envelopeAttributes(envelope: EventEnvelope, system: MessagingSystem): Attributes {
  return {
    [MESSAGING_ATTRIBUTES.SYSTEM]: system,
    [MESSAGING_ATTRIBUTES.DESTINATION]: envelope.topic,
    [MESSAGING_ATTRIBUTES.MESSAGE_ID]: envelope.eventId,
  };
}

/**
 * Zarfi bir PRODUCER span'i icinde yazar. Ust span zarftaki traceparent'tir
 * (outbox'ta saklanan istek baglami); yoksa aktif baglam. Hatta giden zarfin
 * traceparent'i bu span'inkidir: tuketicinin span'i yayinin cocugu olur.
 */
export async function publishInSpan(
  envelope: EventEnvelope,
  system: MessagingSystem,
  send: (traced: EventEnvelope) => Promise<void>,
): Promise<void> {
  const parent =
    envelope.traceparent === undefined
      ? context.active()
      : contextFromTraceparent(envelope.traceparent);
  const span = tracer().startSpan(
    `publish ${envelope.topic}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: {
        ...envelopeAttributes(envelope, system),
        [MESSAGING_ATTRIBUTES.OPERATION]: 'send',
        ...(envelope.requestId === undefined
          ? {}
          : { [MESSAGING_ATTRIBUTES.REQUEST_ID]: envelope.requestId }),
      },
    },
    parent,
  );
  const { traceparent } = currentCorrelation(trace.setSpan(parent, span));
  try {
    await send(traceparent === undefined ? envelope : { ...envelope, traceparent });
  } catch (error: unknown) {
    markFailed(span, 'yayin basarisiz', error);
    throw error;
  } finally {
    span.end();
  }
}

export interface ConsumerSpan {
  readonly span: Span;
  /** Span'in ve requestId'nin aktif oldugu baglam: isleyici bunun icinde kosar. */
  readonly context: Context;
}

export interface ConsumerDelivery {
  readonly group: string;
  readonly attempt: number;
  /** Zarftaki ya da (yoksa) tuketicinin urettigi kimlik. */
  readonly requestId: string;
}

/** Isleyiciye verilen teslimin CONSUMER span'i; ust span zarftaki traceparent. */
export function startConsumerSpan(
  envelope: EventEnvelope,
  delivery: ConsumerDelivery,
): ConsumerSpan {
  const parent = contextFromTraceparent(envelope.traceparent);
  const span = tracer().startSpan(
    `process ${envelope.topic}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        ...envelopeAttributes(envelope, MESSAGING_SYSTEM.REDIS),
        [MESSAGING_ATTRIBUTES.OPERATION]: 'process',
        [MESSAGING_ATTRIBUTES.CONSUMER_GROUP]: delivery.group,
        [MESSAGING_ATTRIBUTES.DELIVERY_ATTEMPT]: delivery.attempt,
        [MESSAGING_ATTRIBUTES.REQUEST_ID]: delivery.requestId,
      },
    },
    parent,
  );
  return { span, context: withRequestId(trace.setSpan(parent, span), delivery.requestId) };
}

/**
 * Isi span'in baglaminda kosturur: isleyicinin gunluk satirlari traceId tasir,
 * giden cagrilari (callUnary) bu span'in cocugu olur.
 */
export function runInConsumerSpan<T>(consumer: ConsumerSpan, work: () => T): T {
  return context.with(consumer.context, work);
}

/** Teslimi kapatir: islenmediyse (ret, gecici hata) ERROR. */
export function endConsumerSpan(
  span: Span,
  failure?: { readonly status: string; readonly error?: unknown },
): void {
  if (failure !== undefined) {
    markFailed(span, failure.status, failure.error);
  }
  span.end();
}

/** ERROR isareti; hata nesnesi varsa istisna ve AppError ise kodu kaydedilir. */
function markFailed(span: Span, status: string, error: unknown): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message: status });
  if (isAppError(error)) {
    span.setAttribute(MESSAGING_ATTRIBUTES.ERROR_CODE, error.code);
  }
  if (error instanceof Error) {
    span.recordException(error);
  }
}
