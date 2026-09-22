/**
 * Zarif kapanis - yalnizca KAPANIS.
 *
 * Sira onemlidir ve bu dosyanin tek isi o sirayi korumaktir:
 *
 *   1) health -> NOT_SERVING  : gateway/probe yeni cagri gondermeyi keser
 *   2) Watch akislari kapanir : acik stream varken sunucu asla bosalmaz
 *   3) tryShutdown            : DEVAM EDEN cagrilarin bitmesi beklenir
 *   4) sure asiminda forceShutdown : takilmis cagri kapanisi sonsuza kilitlemesin
 *   5) onShutdown             : Mongo/Redis baglantilari en SON kapanir
 *
 * (5) sonda cunku (3) sirasinda devam eden cagrilar hala veritabanina yaziyor
 * olabilir; baglantiyi once kapatmak, tam da zarif kapanisla onlemeye
 * calistigimiz yarim kalmis islemi uretirdi.
 *
 * Acilis ayri dosyadadir (server.ts): ikisi ayri sebeplerle degisir - biri
 * servis kaydi ve bind secenekleri, digeri drenaj politikasi ve sure asimi.
 */

import type { Server } from '@grpc/grpc-js';

import { OVERALL_HEALTH_KEY, SERVING_STATUS } from '../config/constants.js';
import type { HealthRegistry } from '../health/registry.js';
import type { Logger } from '../logger.js';
import type { HealthGrpcService } from './health.js';
import type { GrpcServiceRegistration } from './types.js';

export interface GracefulShutdownParams {
  readonly server: Server;
  readonly health: HealthRegistry;
  readonly healthGrpc: HealthGrpcService;
  readonly services: readonly GrpcServiceRegistration[];
  readonly logger: Logger;
  /** Gunluge yazilan sebep: "SIGTERM", "test"... */
  readonly reason: string;
  readonly timeoutMs: number;
  readonly onShutdown?: () => Promise<void> | void;
}

/** Yukaridaki bes adimi sirayla uygular. Hata firlatmaz; kaydini birakir. */
export async function runGracefulShutdown(params: GracefulShutdownParams): Promise<void> {
  const { server, health, healthGrpc, logger, reason, timeoutMs } = params;
  logger.info({ reason, timeoutMs }, 'zarif kapanis basladi');

  health.setStatus(OVERALL_HEALTH_KEY, SERVING_STATUS.NOT_SERVING);
  for (const registration of params.services) {
    if (registration.name !== undefined) {
      health.setStatus(registration.name, SERVING_STATUS.NOT_SERVING);
    }
  }
  healthGrpc.closeWatchers();

  const drained = await drain(server, timeoutMs);
  if (!drained) {
    logger.warn({ timeoutMs }, 'devam eden cagrilar bitmedi, sunucu zorla kapatiliyor');
    server.forceShutdown();
  }

  try {
    await params.onShutdown?.();
  } catch (error: unknown) {
    // Kapanis kancasinin hatasi processi devirmez: sunucu zaten kapandi,
    // yapilacak tek anlamli sey kaydi birakmak.
    logger.error({ err: error }, 'kapanis kancasi hata verdi');
  }

  logger.info({ reason, forced: !drained }, 'zarif kapanis bitti');
}

/**
 * Devam eden cagrilarin bitmesini bekler.
 * @returns true: kendiliginden bosaldi, false: sure asildi.
 */
function drain(server: Server, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    // Zamanlayici unref edilmezse, kapanis erken bitse bile process bu sayac
    // dolana kadar canli kalirdi.
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();

    server.tryShutdown((error) => {
      clearTimeout(timer);
      resolve(error === undefined || error === null);
    });
  });
}
