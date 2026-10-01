/**
 * Her Node servisinin ortak gRPC ortam parcasi.
 *
 * KURAL: `process.env` yalnizca servisin kendi `src/config/env.ts` dosyasinda
 * OKUNUR. Bu dosya okumaz, yalnizca SEMA verir; servis kendi semasini bununla
 * birlestirip loadEnvOrExit'e gecirir:
 *
 *   const envSchema = serviceEnvSchema.extend({
 *     CATALOG_GRPC_PORT: envInt({ min: 1, max: 65535, defaultValue: 50051 }),
 *   });
 *   export const env = loadEnvOrExit(envSchema);
 *
 * PORT BURADA YOK, bilincli olarak: her servisin port degiskeni kendi adini
 * tasir (CATALOG_GRPC_PORT, ORDER_GRPC_PORT...). Tek bir GRPC_PORT olsaydi
 * ayni makinede iki servis ayni degeri okur ve ikincisi "adres kullanimda"
 * ile duserdi.
 */

import { commonEnvSchema, envInt, envOptionalHttpUrl, envString } from '@getir/core';
import type { z } from 'zod';

import {
  DEFAULT_GRPC_HOST,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  METRICS_PORT_OFFSET,
} from './constants.js';

/** Kapanis suresi ust siniri: bundan uzun bekleyen bir kapanis takilmis demektir. */
const MAX_SHUTDOWN_TIMEOUT_MS = 120_000;

/** En kucuk ve en buyuk TCP port numarasi. */
export const MIN_PORT = 1;
export const MAX_PORT = 65_535;

/** gRPC portunun ust siniri: metrik ucu (port + 1000) da gecerli bir port olmali (T10.5). */
export const MAX_GRPC_PORT = MAX_PORT - METRICS_PORT_OFFSET;

/** Ortak + gRPC ortam degiskenleri. Servisler bunu `.extend()` ile genisletir. */
export const serviceEnvSchema = commonEnvSchema.extend({
  /** Dinlenecek adres. Konteynerde 0.0.0.0 olmali; 127.0.0.1 disaridan erisilemez. */
  GRPC_HOST: envString(DEFAULT_GRPC_HOST),

  /**
   * Zarif kapanista devam eden cagrilar icin beklenecek en uzun sure (ms).
   * 0 verilirse bekleme yapilmaz, sunucu dogrudan zorla kapatilir.
   */
  GRPC_SHUTDOWN_TIMEOUT_MS: envInt({
    min: 0,
    max: MAX_SHUTDOWN_TIMEOUT_MS,
    defaultValue: DEFAULT_SHUTDOWN_TIMEOUT_MS,
  }),

  /**
   * Izlerin gonderilecegi OTLP/HTTP taban adresi (D15, ADR-20), orn.
   * http://localhost:4318 (Jaeger). Bossa izler yine olusur ve tasinir
   * (gunlukte traceId) ama disari gonderilmez. Ad OpenTelemetry'nin standart adi.
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: envOptionalHttpUrl(),
});

/** serviceEnvSchema'nin urettigi nesne. Servisler kendi alanlariyla genisletir. */
export type ServiceEnv = z.infer<typeof serviceEnvSchema>;

/**
 * Servis portu icin hazir sema parcasi: `CATALOG_GRPC_PORT: grpcPort(50051)`.
 * En fazla MAX_GRPC_PORT: metrik ucu bu portun 1000 ustunde acilir.
 */
export function grpcPort(defaultValue: number) {
  return envInt({ min: MIN_PORT, max: MAX_GRPC_PORT, defaultValue });
}
