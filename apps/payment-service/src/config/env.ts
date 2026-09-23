/**
 * Ortam degiskenleri. process.env YALNIZCA bu dosya uzerinden okunur.
 *
 * Depo MOCK ile secilir: MOCK=true -> bellek (Mongo parcasi okunmaz), aksi
 * halde MONGO_URI zorunlu ve odemeler `payments` koleksiyonuna yazilir.
 */

import { loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchema } from '@getir/mongo-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import { DEFAULT_PAYMENT_GRPC_PORT } from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  PAYMENT_GRPC_PORT: grpcPort(DEFAULT_PAYMENT_GRPC_PORT),
});

export type PaymentServiceEnv = z.infer<typeof serviceSchema> & {
  /** MOCK=true ise tanimsiz: odemeler bellekte. */
  readonly mongo: MongoEnv | undefined;
};

/** Servis ortami. Mongo parcasi yalnizca MOCK kapaliyken okunur ve zorunludur. */
export function loadServiceEnv(): PaymentServiceEnv {
  const base = loadEnvOrExit(serviceSchema);
  return { ...base, mongo: base.MOCK ? undefined : loadEnvOrExit(mongoEnvSchema) };
}

/** Saglik kontrolu yalnizca portu bilir; baska degisken istemez. */
const healthcheckSchema = z.object({
  PAYMENT_GRPC_PORT: grpcPort(DEFAULT_PAYMENT_GRPC_PORT),
});

export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).PAYMENT_GRPC_PORT };
}
