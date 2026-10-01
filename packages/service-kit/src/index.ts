/**
 * @getir/service-kit - Node servislerinin ortak gRPC acilis takimi.
 *
 * Kapsam: sunucu bootstrap'i, standart health RPC'si, Zod dogrulama ara
 * katmani, AppError -> gRPC status cevirisi, RPC metrikleri ve metrik ucu
 * (T10.5) ve zarif kapanis. Gunlukcu ve request-id @getir/observability'dedir;
 * buradan da disari verilir (eski import yollari). IS MANTIGI
 * ICERMEZ; hangi RPC'nin ne yaptigi servisin kendi `src/application` katmanina
 * aittir.
 */

export * from './config/constants.js';
export * from './config/env.js';
export * from './logger.js';
export * from './shutdown.js';
export * from './startup.js';
export * from './health/registry.js';
export * from './grpc/context.js';
export * from './grpc/handler.js';
export * from './grpc/health.js';
export * from './grpc/health-probe.js';
export { metricsPortFor } from './grpc/metrics-endpoint.js';
export * from './grpc/proto.js';
export * from './grpc/server.js';
export * from './grpc/types.js';
export * from './grpc/status.js';
export * from './grpc/unimplemented.js';
export * from './grpc/unary-call.js';
