/**
 * Ornek servisin ortam degiskenleri.
 *
 * Bu dosya ayni zamanda SABLONDUR: her gercek servisin `src/config/env.ts`
 * dosyasi tipatip boyle gorunur - ortak sema + servise ozel port, tek cagri,
 * eksik degiskende process baslangicta olur.
 */

import { loadEnvOrExit } from '@getir/core';

import { grpcPort, serviceEnvSchema } from '../config/env.js';

/**
 * Ornek servisin portu. Roadmap'teki port haritasinda YER ALMAZ (50051-50056
 * gercek servislere ayrilmistir); 50099 bilincli olarak o araligin disindadir.
 */
const DEFAULT_EXAMPLE_PORT = 50_099;

const envSchema = serviceEnvSchema.extend({
  EXAMPLE_GRPC_PORT: grpcPort(DEFAULT_EXAMPLE_PORT),
});

export const env = loadEnvOrExit(envSchema);
