/**
 * Siparis servisinin ortam degiskenleri.
 * `process.env` TUM serviste yalnizca bu dosyada okunur.
 *
 * MOCK=true ise siparisler BELLEKTE tutulur ve MONGO_URI istenmez: frontend
 * veritabani kurmadan calisabilsin (ADR-09). MOCK kapaliyken Mongo zorunludur;
 * eksik degiskende process acilista oler (loadEnvOrExit) - yarim
 * yapilandirmayla ayaga kalkip ilk siparisde patlamaktan iyidir.
 */

import { loadEnvOrExit } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';
import { mongoEnvSchema } from '@getir/mongo-kit';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';
import { z } from 'zod';

import { DEFAULT_ORDER_GRPC_PORT } from './constants.js';

const serviceSchema = serviceEnvSchema.extend({
  ORDER_GRPC_PORT: grpcPort(DEFAULT_ORDER_GRPC_PORT),
});

export type OrderServiceEnv = z.infer<typeof serviceSchema> & {
  /** MOCK=true ise tanimsiz: siparisler bellekte. */
  readonly mongo: MongoEnv | undefined;
};

/** Servis ortami. Mongo parcasi yalnizca MOCK kapaliyken okunur ve zorunludur. */
export function loadServiceEnv(): OrderServiceEnv {
  const base = loadEnvOrExit(serviceSchema);
  return { ...base, mongo: base.MOCK ? undefined : loadEnvOrExit(mongoEnvSchema) };
}

const healthcheckSchema = z.object({ ORDER_GRPC_PORT: grpcPort(DEFAULT_ORDER_GRPC_PORT) });

/**
 * Yalnizca saglik yoklamasinin ihtiyaci: port. Servisin TAM ortami
 * yuklenmez - yoklama Mongo adresi gibi degiskenlere bagli olmamali; bir
 * degisken eksikse servisin kendisi zaten acilista olmustur.
 */
export function loadHealthcheckEnv(): { readonly port: number } {
  return { port: loadEnvOrExit(healthcheckSchema).ORDER_GRPC_PORT };
}
