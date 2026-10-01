/**
 * Dagitik izleme kurulumu (D15, ADR-20): surecin iz saglayicisi.
 *
 * Span'leri acan kod (service-kit, ileride event-bus) YALNIZCA
 * `@opentelemetry/api`'yi kullanir: saglayici kurulmamissa API hicbir sey yapmaz,
 * kutuphane kodu SDK'ya bagli kalmaz. SDK ve disari gonderen (OTLP/HTTP) yalnizca
 * burada kurulur; servisler bunu startGrpcServer uzerinden alir.
 *
 * Kurallar (ADR-20):
 *  - Baglam W3C `traceparent` ile tasinir (yalnizca trace context; baggage yok).
 *  - Her istek orneklenir: ParentBased(AlwaysOn); ust span'in karari korunur.
 *  - Uc adresi (OTEL_EXPORTER_OTLP_ENDPOINT) yoksa span'ler yine olusur ve
 *    tasinir - gunluk satiri traceId tasir - ama disari GONDERILMEZ.
 *  - Saglayici surecte TEK: ikinci startTracing ilk kurulumu kullanir.
 */

import { setGlobalErrorHandler, W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  NodeTracerProvider,
  ParentBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import { silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';

import { registeredProvider, registerProvider } from './state.js';

/** OTLP/HTTP'nin iz yolu; taban adrese eklenir (http://localhost:4318 -> .../v1/traces). */
export const OTLP_TRACES_PATH = '/v1/traces';

/** Kapanista bekleyen span'leri gondermek icin taninan en uzun sure. */
export const TRACE_FLUSH_TIMEOUT_MS = 2_000;

/**
 * Izleme hatasi (orn. Jaeger kapali: disari gonderme her partide duser) en fazla
 * bu aralikla gunluge yazilir; aradakiler sayilip sonraki satirda bildirilir.
 */
export const TRACE_ERROR_LOG_INTERVAL_MS = 60_000;

export interface TracingOptions {
  /** Kisa servis adi; iz goruntuleyicide `service.name`. */
  readonly serviceName: string;
  /** OTLP/HTTP taban adresi (http://localhost:4318). Verilmezse izler disari gonderilmez. */
  readonly otlpEndpoint?: string | undefined;
  /** Izleme hatalarinin yazilacagi gunlukcu. */
  readonly logger?: Logger;
}

export interface Tracing {
  /** Bekleyen span'leri gonderir; en fazla TRACE_FLUSH_TIMEOUT_MS bekler, hata firlatmaz. */
  flush(): Promise<void>;
}

/** Saglayiciyi kurar ve surece kaydeder; ikinci cagri ilk kurulumu kullanir. */
export function startTracing(options: TracingOptions): Tracing {
  const logger = (options.logger ?? silentLogger).child({ component: 'tracing' });
  const existing = registeredProvider();
  if (existing !== undefined) {
    return tracingOf(existing, logger);
  }

  const spanProcessors: SpanProcessor[] =
    options.otlpEndpoint === undefined
      ? []
      : [
          new BatchSpanProcessor(
            new OTLPTraceExporter({ url: `${options.otlpEndpoint}${OTLP_TRACES_PATH}` }),
          ),
        ];
  const provider = installProvider(options.serviceName, spanProcessors);
  setGlobalErrorHandler(throttledErrorLog(logger));
  return tracingOf(provider, logger);
}

/**
 * Saglayiciyi kurar ve SURECE kaydeder (paket ici; test yardimcisi da bunu
 * kullanir). register: AsyncLocalStorage baglam yoneticisi + W3C yayici kuresel
 * olur; span await zinciri boyunca (gunluk satiri, giden cagri) gorunur.
 */
export function installProvider(
  serviceName: string,
  spanProcessors: SpanProcessor[],
): NodeTracerProvider {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
    spanProcessors,
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  registerProvider(provider);
  return provider;
}

function tracingOf(provider: NodeTracerProvider, logger: Logger): Tracing {
  return { flush: () => flushWithin(provider, TRACE_FLUSH_TIMEOUT_MS, logger) };
}

/** forceFlush'i sure siniriyla bekler; dolan sure ya da hata kapanisi durdurmaz. */
async function flushWithin(
  provider: NodeTracerProvider,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), timeoutMs);
    timer.unref();
  });
  try {
    const outcome = await Promise.race([
      provider.forceFlush().then(() => 'flushed' as const),
      timedOut,
    ]);
    if (outcome === 'timed-out') {
      logger.warn({ timeoutMs }, 'izler suresinde gonderilemedi');
    }
  } catch (error: unknown) {
    logger.warn({ err: error }, 'izler gonderilemedi');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OpenTelemetry'nin kuresel hata isleyicisi: hata JSON gunluge WARN olarak gider
 * (varsayilani sessizdir). Ayni sorun her partide tekrar ettigi icin satir
 * TRACE_ERROR_LOG_INTERVAL_MS'de bir yazilir; aradakiler `suppressed` alaninda.
 */
export function throttledErrorLog(
  logger: Logger,
  now: () => number = Date.now,
): (error: unknown) => void {
  let lastLoggedAt = Number.NEGATIVE_INFINITY;
  let suppressed = 0;
  return (error) => {
    const at = now();
    if (at - lastLoggedAt < TRACE_ERROR_LOG_INTERVAL_MS) {
      suppressed += 1;
      return;
    }
    logger.warn({ err: error, suppressed }, 'izleme hatasi; izler gonderilemiyor olabilir');
    lastLoggedAt = at;
    suppressed = 0;
  };
}
