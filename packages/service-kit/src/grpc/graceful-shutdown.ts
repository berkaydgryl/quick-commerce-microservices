/**
 * Zarif kapanis - yalnizca KAPANIS.
 *
 * Sira onemlidir ve bu dosyanin tek isi o sirayi korumaktir:
 *
 *   1) health -> NOT_SERVING  : gateway/probe yeni cagri gondermeyi keser
 *   2) Watch akislari kapanir : acik stream varken sunucu asla bosalmaz
 *   3) tryShutdown            : DEVAM EDEN cagrilarin bitmesi beklenir
 *   4) sure asiminda forceShutdown : takilmis cagri kapanisi sonsuza kilitlemesin
 *   5) metrik ucu kapanir     : drenaj boyunca acikti, son kazima kapanisi da gorur (T10.5)
 *   6) onShutdown             : isciler ve Mongo/Redis baglantilari kapanir;
 *                               hookTimeoutMs'de bitmezse beklenmez (#56)
 *   7) izler gonderilir       : bekleyen span'ler (en cok 2 sn; D15)
 *
 * (6) sonda cunku (3) sirasinda devam eden cagrilar hala veritabanina yaziyor
 * olabilir; baglantiyi once kapatmak, tam da zarif kapanisla onlemeye
 * calistigimiz yarim kalmis islemi uretirdi.
 *
 * Her adim sinirlidir: kapanis en gec timeoutMs + METRICS_CLOSE_GRACE_MS +
 * hookTimeoutMs + TRACE_FLUSH_TIMEOUT_MS'de biter, surec cikar (takilmis bir
 * Mongo kapanisi ya da isci turu sureci ayakta tutmaz).
 *
 * Acilis ayri dosyadadir (server.ts): ikisi ayri sebeplerle degisir - biri
 * servis kaydi ve bind secenekleri, digeri drenaj politikasi ve sure asimi.
 */

import type { MetricsServer } from '@getir/observability';
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
  /** HTTP /metrics ucu; kapanisi hata firlatmaz. */
  readonly metrics: Pick<MetricsServer, 'close'>;
  readonly logger: Logger;
  /** Gunluge yazilan sebep: "SIGTERM", "test"... */
  readonly reason: string;
  readonly timeoutMs: number;
  /** onShutdown icin beklenecek en uzun sure (ms). */
  readonly hookTimeoutMs: number;
  /** Bekleyen span'leri gonderir (D15); kendi suresiyle sinirli, hata firlatmaz. */
  readonly flushTraces: () => Promise<void>;
  readonly onShutdown?: () => Promise<void> | void;
}

/** Kapanis kancasinin sonucu; "zarif kapanis bitti" satirinda `hook` alani. */
type HookOutcome = 'done' | 'failed' | 'timed-out';

/** Yukaridaki yedi adimi sirayla uygular. Hata firlatmaz; kaydini birakir. */
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

  await params.metrics.close();
  const hook = await runHook(params.onShutdown, params.hookTimeoutMs, logger);
  // En son: kapanis sirasinda biten span'ler (son cagrilar) da gitsin.
  await params.flushTraces();

  logger.info({ reason, forced: !drained, hook }, 'zarif kapanis bitti');
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

/**
 * Kapanis kancasini sure siniriyla calistirir. Kancanin hatasi da sure asimi da
 * kapanisi durdurmaz: sunucu zaten kapandi, yapilacak tek anlamli sey kaydi
 * birakmak. Sure asiminda kancanin suren isi beklenmez; surec cikarken kesilir.
 */
async function runHook(
  onShutdown: (() => Promise<void> | void) | undefined,
  timeoutMs: number,
  logger: Logger,
): Promise<HookOutcome> {
  if (onShutdown === undefined) {
    return 'done';
  }
  let timer: NodeJS.Timeout | undefined;
  // unref EDILMEZ: suren kanca bekleyen tek is olsa da sure dolsun ve kapanis bitsin.
  const timedOut = new Promise<HookOutcome>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), timeoutMs);
  });
  const finished = Promise.resolve()
    .then(onShutdown)
    .then((): HookOutcome => 'done');
  try {
    const outcome = await Promise.race([finished, timedOut]);
    if (outcome === 'timed-out') {
      logger.error({ hookTimeoutMs: timeoutMs }, 'kapanis kancasi suresinde bitmedi; beklenmiyor');
    }
    return outcome;
  } catch (error: unknown) {
    logger.error({ err: error }, 'kapanis kancasi hata verdi');
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}
