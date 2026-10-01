/**
 * Ortam degiskenleri. process.env YALNIZCA bu dosya uzerinden okunur.
 * Depo MOCK ile secilir: MOCK=true -> bellek, aksi halde RISK_MONGO_URI zorunlu
 * (kendi veritabani ve kullanicisi, D14).
 */

import { loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchemaFor } from '@getir/mongo-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import { DEFAULT_MONGO_DB, DEFAULT_RISK_GRPC_PORT } from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  RISK_GRPC_PORT: grpcPort(DEFAULT_RISK_GRPC_PORT),
});

/** Servisin kendi veritabani ve kullanicisi (D14): RISK_MONGO_URI, RISK_MONGO_DB. */
const mongoSchema = mongoEnvSchemaFor({ prefix: 'RISK', defaultDb: DEFAULT_MONGO_DB });

export type RiskServiceEnv = z.infer<typeof serviceSchema> & {
  /** MOCK=true ise tanimsiz: degerlendirme kayitlari bellekte. */
  readonly mongo: MongoEnv | undefined;
};

export function loadServiceEnv(): RiskServiceEnv {
  const base = loadEnvOrExit(serviceSchema);
  return { ...base, mongo: base.MOCK ? undefined : loadEnvOrExit(mongoSchema) };
}

const healthcheckSchema = z.object({ RISK_GRPC_PORT: grpcPort(DEFAULT_RISK_GRPC_PORT) });

export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).RISK_GRPC_PORT };
}
