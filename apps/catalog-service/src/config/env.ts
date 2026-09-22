/**
 * Katalog servisinin ortam degiskenleri.
 * `process.env` TUM serviste yalnizca bu dosyada okunur.
 */

import { loadEnvOrExit } from '@getir/core';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';

import { DEFAULT_CATALOG_GRPC_PORT } from './constants.js';

const envSchema = serviceEnvSchema.extend({
  CATALOG_GRPC_PORT: grpcPort(DEFAULT_CATALOG_GRPC_PORT),
});

/**
 * Dogrulanmis yapilandirma. Eksik/gecersiz degiskende process acilista oler;
 * bu, servisin yarim yapilandirmayla ayaga kalkip ilk istekte patlamasindan
 * iyidir.
 *
 * MONGO_URI burada YOK: T3.1 katalog verisini bellekten okur (sahte veri).
 * Mongo bagimliligi T4.1'de eklenecek.
 */
export const env = loadEnvOrExit(envSchema);
