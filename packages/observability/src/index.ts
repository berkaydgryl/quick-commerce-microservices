/**
 * @getir/observability - gozlemlenebilirlik (T10.5, D15, D16): gunluk, korelasyon
 * kimligi, iz (olay hattindaki korelasyon dahil) ve metrik.
 *
 * Kapsam: pino gunlukcusu (stdout, esli; satirda traceId), request-id kurali,
 * iz saglayicisi (OpenTelemetry, D15), surecin metrik defteri ve metrik
 * ureticileri, HTTP /metrics ucu. gRPC'ye BAGLI DEGILDIR: metadata okuma, RPC
 * span'leri ve metrikleri ve metrik ucunun port kurali service-kit'tedir.
 */

export * from './logger.js';
export { STDOUT_LOST_MESSAGE } from './log-destination.js';
export * from './request-id.js';
export * from './metrics/registry.js';
export * from './metrics/server.js';
export {
  OTLP_TRACES_PATH,
  startTracing,
  TRACE_ERROR_LOG_INTERVAL_MS,
  TRACE_FLUSH_TIMEOUT_MS,
} from './tracing/provider.js';
export type { Tracing, TracingOptions } from './tracing/provider.js';
export * from './tracing/correlation.js';
