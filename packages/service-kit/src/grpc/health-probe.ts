/**
 * Konteyner saglik yoklamasi (Docker HEALTHCHECK) - istemci tarafi.
 *
 * NEDEN BURADA: her servis ayni yoklamayi yapiyordu ve iki servisin
 * healthcheck.ts dosyasi BIREBIR aynisiydi; her yeni servis bir kopya daha
 * demekti. Servis artik yalnizca portunu verir (kendi config/env.ts'inden).
 *
 * NEDEN AYRI BIR ARAC DEGIL: konteynerde HTTP ucu yok, curl ile sorulamaz.
 * grpc_health_probe ikilisini imaja indirmek fazladan indirme ve surum takibi
 * demek; servis zaten grpc.health.v1 konusuyor, birkac satirla kendimiz soruyoruz.
 */

import { Client, credentials, Metadata } from '@grpc/grpc-js';
import type { MethodDefinition } from '@grpc/grpc-js';

import { SERVING_STATUS } from '../config/constants.js';
import { healthServiceDefinition } from './health.js';

/** Docker'in bekledigi cikis kodlari. */
export const HEALTHCHECK_EXIT_CODE = {
  HEALTHY: 0,
  UNHEALTHY: 1,
} as const;

/** Yoklamanin en fazla bekleyecegi sure (ms): HEALTHCHECK --timeout'un altinda. */
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

/** Yoklama kendi surecine sorar; konteyner icinde servis 127.0.0.1'dedir. */
const DEFAULT_PROBE_HOST = '127.0.0.1';

export interface HealthProbeOptions {
  readonly port: number;
  readonly host?: string;
  readonly timeoutMs?: number;
}

interface HealthCheckRequest {
  service: string;
}
interface HealthCheckResponse {
  status: string;
}

/**
 * Sunucu SERVING mi? Hata, zaman asimi ve baska her durum "hayir"dir.
 *
 * Istemci her durumda kapatilir: acik kalirsa process bosalmaz ve
 * HEALTHCHECK kendi zaman asimina kadar asili kalir.
 */
export function probeHealth(options: HealthProbeOptions): Promise<boolean> {
  const host = options.host ?? DEFAULT_PROBE_HOST;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const client = new Client(`${host}:${options.port}`, credentials.createInsecure());
  // Tip tesisati: tanim proto-loader'dan tipsiz gelir; alanlar sozlesmededir.
  const check = healthServiceDefinition.Check as MethodDefinition<
    HealthCheckRequest,
    HealthCheckResponse
  >;

  return new Promise((resolve) => {
    client.makeUnaryRequest(
      check.path,
      check.requestSerialize,
      check.responseDeserialize,
      // Bos servis adi = "butun sunucu ayakta mi?"
      { service: '' },
      new Metadata(),
      { deadline: new Date(Date.now() + timeoutMs) },
      (error, response) => {
        client.close();
        resolve(error === null && response?.status === SERVING_STATUS.SERVING);
      },
    );
  });
}
