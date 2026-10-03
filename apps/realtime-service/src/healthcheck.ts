/**
 * Konteyner saglik kontrolu (Docker HEALTHCHECK, D7).
 *
 * Servisin kendi saglik ucunu (GET /healthz, ayni port) yoklar. gRPC servisleri
 * probeHealth ile grpc.health.v1'i cagirir; realtime gRPC sunmadigi icin HTTP.
 * Port config/env.ts'ten ve DOGRULANMIS olarak gelir.
 *
 * Cikis kodu: 0 = 200 (SERVING), 1 = digerleri (Docker'in bekledigi sozlesme).
 */

import { get } from 'node:http';

import { HTTP_STATUS } from '@getir/core';
import { HEALTHCHECK_EXIT_CODE } from '@getir/service-kit';

import { HEALTH_PATH, HEALTHCHECK_TIMEOUT_MS } from './config/constants.js';
import { loadHealthcheckEnv } from './config/env.js';

/** Konteynerin kendi loopback'i: yoklama disariya cikmaz. */
const LOOPBACK_HOST = '127.0.0.1';

const { port } = loadHealthcheckEnv();

function probe(): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get(
      { host: LOOPBACK_HOST, port, path: HEALTH_PATH, timeout: HEALTHCHECK_TIMEOUT_MS },
      (response) => {
        // Govde okunmaz ama tuketilir: aksi halde baglanti acik kalir.
        response.resume();
        resolve(response.statusCode === HTTP_STATUS.OK);
      },
    );
    request.on('timeout', () => {
      request.destroy();
    });
    request.on('error', () => {
      resolve(false);
    });
  });
}

process.exitCode = (await probe())
  ? HEALTHCHECK_EXIT_CODE.HEALTHY
  : HEALTHCHECK_EXIT_CODE.UNHEALTHY;
