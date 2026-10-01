/**
 * gRPC izleri (D15, ADR-20): sunucu span'i (unaryHandler) ve istemci span'i
 * (callUnary'nin cagri ara katmani). Iz baglami W3C `traceparent` metadata
 * anahtariyla tasinir; gateway (Go, internal/rpc TracingInterceptor) ayni
 * anahtari yazar. Saglik yoklamalari (grpc.health.v1) izlenmez.
 *
 * YALNIZCA `@opentelemetry/api`: saglayici kurulmamissa (arac, saglayicisiz
 * test) span'ler hicbir sey yapmaz. Saglayiciyi startGrpcServer kurar
 * (@getir/observability startTracing).
 *
 * Hata isareti kodun agirligindan gelir (@getir/core ERROR_CODE_SEVERITY):
 * beklenen is sonucu (stok yok) span'i hatali isaretlemez; siradisi ve
 * beklenmeyen hata ERROR olur, beklenmeyen olanin istisnasi da kaydedilir.
 * Etiketlerde kimlik yoktur; `app.request_id` korelasyon icindir (Jaeger'de
 * bu etiketle aranir), metrik etiketi olmaz.
 */

import { ERROR_SEVERITY, errorSeverityFor } from '@getir/core';
import type { ErrorCode, ErrorSeverity } from '@getir/core';
import { InterceptingCall, ListenerBuilder, status as GrpcStatus } from '@grpc/grpc-js';
import type { Interceptor, Metadata } from '@grpc/grpc-js';
import {
  context,
  INVALID_SPAN_CONTEXT,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import type { Context, Span, TextMapGetter, TextMapSetter } from '@opentelemetry/api';

import { errorCodeOfStatus } from './status.js';

/** Span'leri acan kutuphanenin adi (iz goruntuleyicide "instrumentation scope"). */
const TRACER_NAME = '@getir/service-kit';

/** Span nitelikleri: RPC olanlar OpenTelemetry anlam kurallarindan (rpc.*). */
export const SPAN_ATTRIBUTES = {
  RPC_SYSTEM: 'rpc.system',
  RPC_SERVICE: 'rpc.service',
  RPC_METHOD: 'rpc.method',
  RPC_STATUS: 'rpc.grpc.status_code',
  REQUEST_ID: 'app.request_id',
  ERROR_CODE: 'app.error_code',
} as const;

const RPC_SYSTEM_GRPC = 'grpc';

/**
 * gRPC saglik protokolu. Yoklamalari izlenmez (ADR-20): gateway /healthz'i ve
 * Docker HEALTHCHECK'i surekli yoklar, her yoklama ayri bir iz olurdu. Gateway'in
 * istemci ara katmani da ayni oneki atlar.
 */
const HEALTH_PATH_PREFIX = '/grpc.health.v1.Health/';

/** gRPC metadata'sindan W3C basliklarini okur (traceparent, tracestate). */
const metadataGetter: TextMapGetter<Metadata> = {
  keys: (metadata) => Object.keys(metadata.getMap()),
  get: (metadata, key) => {
    const [value] = metadata.get(key);
    return typeof value === 'string' ? value : undefined;
  },
};

const metadataSetter: TextMapSetter<Metadata> = {
  set: (metadata, key, value) => {
    metadata.set(key, value);
  },
};

/** Saglayici sonradan kurulsa da (startGrpcServer) guncel izleyiciyi alir. */
function tracer() {
  return trace.getTracer(TRACER_NAME);
}

/** "/getir.order.v1.OrderService/CreateOrder" -> span adi ve rpc.* nitelikleri. */
export function rpcNameOf(path: string): { name: string; service: string; method: string } {
  const name = path.startsWith('/') ? path.slice(1) : path;
  const slash = name.lastIndexOf('/');
  return slash < 0
    ? { name, service: '', method: name }
    : { name, service: name.slice(0, slash), method: name.slice(slash + 1) };
}

export interface ServerSpan {
  readonly span: Span;
  /** Span'in aktif oldugu baglam: handler bunun icinde kosar. */
  readonly context: Context;
}

/** Izlenmeyen cagri: kayit tutmayan span (nitelik ve kapanis bir sey yapmaz), bos baglam. */
const UNTRACED: ServerSpan = {
  span: trace.wrapSpanContext(INVALID_SPAN_CONTEXT),
  context: ROOT_CONTEXT,
};

/**
 * Gelen cagrinin sunucu span'ini acar; ust span metadata'daki traceparent'tan.
 * Saglik yoklamasinda span acilmaz.
 */
export function startServerSpan(path: string, metadata: Metadata, requestId: string): ServerSpan {
  if (path.startsWith(HEALTH_PATH_PREFIX)) {
    return UNTRACED;
  }
  const parent = propagation.extract(ROOT_CONTEXT, metadata, metadataGetter);
  const { name, service, method } = rpcNameOf(path);
  const span = tracer().startSpan(
    name,
    {
      kind: SpanKind.SERVER,
      attributes: {
        [SPAN_ATTRIBUTES.RPC_SYSTEM]: RPC_SYSTEM_GRPC,
        [SPAN_ATTRIBUTES.RPC_SERVICE]: service,
        [SPAN_ATTRIBUTES.RPC_METHOD]: method,
        [SPAN_ATTRIBUTES.REQUEST_ID]: requestId,
      },
    },
    parent,
  );
  return { span, context: trace.setSpan(parent, span) };
}

/**
 * Isi span'in baglaminda kosturur: await zinciri boyunca span aktiftir; gunluk
 * satiri traceId tasir, giden cagri bu span'in cocugu olur.
 */
export function runInSpan<T>(server: ServerSpan, work: () => T): T {
  return context.with(server.context, work);
}

export interface RpcFailure {
  readonly errorCode: ErrorCode;
  readonly severity: ErrorSeverity;
  readonly error: unknown;
}

/** Sunucu ya da istemci span'ini sonucla kapatir. */
export function endRpcSpan(span: Span, grpcStatus: number, failure?: RpcFailure): void {
  span.setAttribute(SPAN_ATTRIBUTES.RPC_STATUS, grpcStatus);
  if (failure !== undefined) {
    span.setAttribute(SPAN_ATTRIBUTES.ERROR_CODE, failure.errorCode);
    if (failure.severity !== ERROR_SEVERITY.EXPECTED) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: failure.errorCode });
    }
    if (failure.severity === ERROR_SEVERITY.UNEXPECTED && failure.error instanceof Error) {
      span.recordException(failure.error);
    }
  }
  span.end();
}

/**
 * Giden cagrinin istemci span'i (callUnary her cagriya ekler). Span, cagrinin
 * yapildigi baglamin (sunucu span'i) cocugudur; traceparent metadata'ya yazilir,
 * karsi servis onu ust span yapar. Kapanis durum koduyla, hata isareti karsi
 * tarafin AppError kodunun agirligindan. Saglik cagrisi span acmadan gecer.
 */
export const clientTracingInterceptor: Interceptor = (options, nextCall) => {
  if (options.method_definition.path.startsWith(HEALTH_PATH_PREFIX)) {
    return new InterceptingCall(nextCall(options));
  }
  const parent = context.active();
  const { name, service, method } = rpcNameOf(options.method_definition.path);
  const span = tracer().startSpan(
    name,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        [SPAN_ATTRIBUTES.RPC_SYSTEM]: RPC_SYSTEM_GRPC,
        [SPAN_ATTRIBUTES.RPC_SERVICE]: service,
        [SPAN_ATTRIBUTES.RPC_METHOD]: method,
      },
    },
    parent,
  );
  const spanContext = trace.setSpan(parent, span);
  return new InterceptingCall(nextCall(options), {
    start: (metadata, _listener, next) => {
      propagation.inject(spanContext, metadata, metadataSetter);
      next(
        metadata,
        new ListenerBuilder()
          .withOnReceiveStatus((status, nextStatus) => {
            if (status.code === GrpcStatus.OK) {
              endRpcSpan(span, status.code);
            } else {
              const errorCode = errorCodeOfStatus(status.code, status.metadata);
              endRpcSpan(span, status.code, {
                errorCode,
                severity: errorSeverityFor(errorCode),
                error: undefined,
              });
            }
            nextStatus(status);
          })
          .build(),
      );
    },
  });
};
