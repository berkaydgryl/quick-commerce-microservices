/**
 * Ortam degiskenleri. process.env YALNIZCA bu dosya uzerinden okunur.
 *
 * Bugun Mongo parcasi yok: odemeler bellekte tutulur ve payments koleksiyonu
 * T5.3 ile gelir. O gorevde order-service'teki gibi MOCK kapaliyken
 * mongoEnvSchema eklenecek.
 */

import { loadEnvOrExit } from '@getir/core';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import { DEFAULT_PAYMENT_GRPC_PORT } from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  PAYMENT_GRPC_PORT: grpcPort(DEFAULT_PAYMENT_GRPC_PORT),
});

export type PaymentServiceEnv = z.infer<typeof serviceSchema>;

export function loadServiceEnv(): PaymentServiceEnv {
  return loadEnvOrExit(serviceSchema);
}

/** Saglik kontrolu yalnizca portu bilir; baska degisken istemez. */
const healthcheckSchema = z.object({
  PAYMENT_GRPC_PORT: grpcPort(DEFAULT_PAYMENT_GRPC_PORT),
});

export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).PAYMENT_GRPC_PORT };
}
