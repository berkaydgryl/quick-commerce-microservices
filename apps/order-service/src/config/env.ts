/**
 * Siparis servisinin ortam degiskenleri.
 * `process.env` TUM serviste yalnizca bu dosyada okunur.
 */

import { loadEnvOrExit } from '@getir/core';
import { grpcPort, serviceEnvSchema } from '@getir/service-kit';

import { DEFAULT_ORDER_GRPC_PORT } from './constants.js';

const envSchema = serviceEnvSchema.extend({
  ORDER_GRPC_PORT: grpcPort(DEFAULT_ORDER_GRPC_PORT),
});

/**
 * Dogrulanmis yapilandirma. Eksik/gecersiz degiskende process acilista oler.
 *
 * MONGO_URI burada YOK: T3.2 siparisi yalnizca BELLEKTE tutar. Kalicilik
 * (orders repository) T4.5'te, durum makinesi tablosu T4.4'te gelecek.
 */
export const env = loadEnvOrExit(envSchema);
