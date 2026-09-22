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

import { commonEnvSchema, envInt } from '@getir/core';
import { z } from 'zod';

import { DEFAULT_GRPC_HOST, DEFAULT_SHUTDOWN_TIMEOUT_MS } from './constants.js';

/** Kapanis suresi ust siniri: bundan uzun bekleyen bir kapanis takilmis demektir. */
const MAX_SHUTDOWN_TIMEOUT_MS = 120_000;

/** En kucuk ve en buyuk TCP port numarasi. */
export const MIN_PORT = 1;
export const MAX_PORT = 65_535;

/**
 * Metin ortam degiskeni.
 *
 * Tanimsiz VE bos metin ayni sayilir: docker-compose'da "GRPC_HOST=" yazmak
 * degiskeni bos string olarak gecirir; zod'un `.default()` bunu tanimli kabul
 * edip varsayilani uygulamaz ve servis bos adrese baglanmaya calisirdi.
 */
export function envString(defaultValue: string) {
  return z
    .string()
    .optional()
    .transform((raw) => {
      const text = raw?.trim() ?? '';
      return text === '' ? defaultValue : text;
    });
}

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
});

/** serviceEnvSchema'nin urettigi nesne. Servisler kendi alanlariyla genisletir. */
export type ServiceEnv = z.infer<typeof serviceEnvSchema>;

/** Servis portu icin hazir sema parcasi: `CATALOG_GRPC_PORT: grpcPort(50051)`. */
export function grpcPort(defaultValue: number) {
  return envInt({ min: MIN_PORT, max: MAX_PORT, defaultValue });
}
