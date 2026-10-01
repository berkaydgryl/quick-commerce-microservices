/**
 * unaryHandler'in metrikleri (T10.5): istek sayaci ve sure histogrami.
 *
 * Etiketler YALNIZCA `rpc` (koddaki RPC adi) ve `code`: basarida `OK`, hatada
 * AppError kodu (ERROR_CODES, kapali liste; beklenmeyen hata `INTERNAL`).
 * Kimlik, kullanici ya da istek verisi etiket olmaz (kural:
 * @getir/observability metrics/registry.ts). Surecin `service` etiketi her
 * metrikte ayrica vardir (startGrpcServer koyar).
 */

import { counter, histogram } from '@getir/observability';

export const RPC_METRICS = {
  REQUESTS: 'grpc_server_requests_total',
  DURATION: 'grpc_server_request_duration_seconds',
} as const;

/** Basarili cagrinin `code` etiketi; hata kodlari ERROR_CODES'tan gelir. */
export const RPC_OK_CODE = 'OK';

type RpcLabel = 'rpc' | 'code';

const requests = counter<RpcLabel>({
  name: RPC_METRICS.REQUESTS,
  help: 'Tamamlanan unary gRPC cagrilari; code: OK ya da AppError kodu',
  labelNames: ['rpc', 'code'],
});

const duration = histogram<RpcLabel>({
  name: RPC_METRICS.DURATION,
  help: 'Unary gRPC cagrisinin sunucudaki suresi (sn): dogrulama + is mantigi',
  labelNames: ['rpc', 'code'],
});

/** Tamamlanan cagriyi sayar ve suresini kaydeder. */
export function recordRpc(rpc: string, code: string, seconds: number): void {
  const labels = { rpc, code };
  requests.inc(labels);
  duration.observe(labels, seconds);
}
