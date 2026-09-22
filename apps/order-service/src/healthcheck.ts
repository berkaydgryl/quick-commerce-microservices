/**
 * Konteyner saglik kontrolu (Docker HEALTHCHECK).
 *
 * NEDEN AYRI BIR BETIK: konteyner icinde HTTP ucu yok, servis gRPC konusuyor;
 * `curl` ile kontrol edilemez. Yaygin alternatif `grpc_health_probe` ikilisini
 * imaja indirmektir - fazladan bir indirme ve surum takibi demek. Servis zaten
 * standart grpc.health.v1 sozlesmesini konusuyor ve @getir/service-kit o
 * sozlesmenin tanimini disari veriyor; birkac satirla kendimiz soruyoruz.
 *
 * Cikis kodu: 0 = SERVING, 1 = digerleri (Docker'in bekledigi sozlesme).
 */

import { healthServiceDefinition, SERVING_STATUS } from '@getir/service-kit';
import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition } from '@grpc/grpc-js';

import { DEFAULT_ORDER_GRPC_PORT } from './config/constants.js';

/** Saglik sorgusunun en fazla bekleyecegi sure (ms). */
const HEALTHCHECK_TIMEOUT_MS = 2_000;

const HEALTHY = 0;
const UNHEALTHY = 1;

interface HealthCheckRequest {
  service: string;
}
interface HealthCheckResponse {
  status: string;
}

const port = process.env.ORDER_GRPC_PORT ?? String(DEFAULT_ORDER_GRPC_PORT);
const client = new Client(`127.0.0.1:${port}`, credentials.createInsecure());
const check = healthServiceDefinition.Check as MethodDefinition<
  HealthCheckRequest,
  HealthCheckResponse
>;

const deadline = new Date(Date.now() + HEALTHCHECK_TIMEOUT_MS);

client.makeUnaryRequest(
  check.path,
  check.requestSerialize,
  check.responseDeserialize,
  // Bos servis adi = "butun sunucu ayakta mi?"
  { service: '' },
  new Metadata(),
  { deadline },
  (error, response) => {
    client.close();
    const healthy = error === null && response?.status === SERVING_STATUS.SERVING;
    process.exit(healthy ? HEALTHY : UNHEALTHY);
  },
);
