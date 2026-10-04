/**
 * Konteyner saglik kontrolu (Docker HEALTHCHECK). Yoklamanin kendisi
 * @getir/service-kit'tedir (probeHealth); burada yalnizca bu servisin portu
 * verilir (config/env.ts, dogrulanmis).
 *
 * Cikis kodu: 0 = SERVING, 1 = digerleri (Docker'in bekledigi sozlesme).
 */

import { HEALTHCHECK_EXIT_CODE, probeHealth } from '@getir/service-kit';

import { loadHealthcheckEnv } from './config/env.js';

const { port } = loadHealthcheckEnv();

process.exitCode = (await probeHealth({ port }))
  ? HEALTHCHECK_EXIT_CODE.HEALTHY
  : HEALTHCHECK_EXIT_CODE.UNHEALTHY;
