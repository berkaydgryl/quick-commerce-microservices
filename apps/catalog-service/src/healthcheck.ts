/**
 * Konteyner saglik kontrolu (Docker HEALTHCHECK).
 *
 * Yoklamanin kendisi @getir/service-kit'tedir (probeHealth): her servis ayni
 * isi yapiyordu ve dosyalar birebir aynisiydi. Burada yalnizca bu servisin
 * portu verilir. Port, kuralin istedigi gibi config/env.ts'ten ve DOGRULANMIS
 * olarak gelir (onceki surum process.env'i dogrudan okuyordu).
 *
 * Cikis kodu: 0 = SERVING, 1 = digerleri (Docker'in bekledigi sozlesme).
 */

import { HEALTHCHECK_EXIT_CODE, probeHealth } from '@getir/service-kit';

import { loadHealthcheckEnv } from './config/env.js';

const { port } = loadHealthcheckEnv();

process.exitCode = (await probeHealth({ port }))
  ? HEALTHCHECK_EXIT_CODE.HEALTHY
  : HEALTHCHECK_EXIT_CODE.UNHEALTHY;
