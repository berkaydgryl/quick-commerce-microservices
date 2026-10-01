/**
 * @getir/observability - gozlemlenebilirlik (T10.5): gunluk, korelasyon
 * kimligi ve metrik.
 *
 * Kapsam: pino gunlukcusu (stdout, esli), request-id kurali, surecin metrik
 * defteri ve metrik ureticileri, HTTP /metrics ucu. gRPC'ye BAGLI DEGILDIR:
 * metadata okuma, RPC metrikleri ve metrik ucunun port kurali service-kit'tedir.
 * Dagitik izleme (OpenTelemetry) D15'te buraya eklenir.
 */

export * from './logger.js';
export { STDOUT_LOST_MESSAGE } from './log-destination.js';
export * from './request-id.js';
export * from './metrics/registry.js';
export * from './metrics/server.js';
