/**
 * gRPC sunucusunun acilisi ve zarif kapanisi.
 *
 * Bir Node servisinin `bootstrap.ts` dosyasinin yaptigi is buraya iner:
 * sunucuyu kur, health servisini bagla, portu ac, durumu SERVING'e cevir.
 * Kapanista ise sira TERSTIR ve onemlidir:
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
 */

import { AppError } from '@getir/core';
import { Server, ServerCredentials } from '@grpc/grpc-js';
import type { ServiceDefinition, UntypedServiceImplementation } from '@grpc/grpc-js';

import {
  DEFAULT_GRPC_HOST,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  OVERALL_HEALTH_KEY,
  SERVING_STATUS,
} from '../config/constants.js';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import { healthServiceDefinition, HealthService } from './health.js';

/** Sunucuya baglanacak tek bir servis. */
export interface GrpcServiceRegistration {
  /** Uretilen (ts-proto) ya da yuklenen servis tanimi. */
  readonly definition: ServiceDefinition;
  /** RPC adlarindan handler'lara esleme. */
  readonly implementation: UntypedServiceImplementation;
  /**
   * Tam nitelikli servis adi (orn. "getir.catalog.v1.CatalogService").
   * Verilirse health tablosuna ayri bir satir olarak yazilir; boylece
   * gateway tek tek servis bazinda da durum sorabilir.
   */
  readonly name?: string;
}

export interface GrpcServerOptions {
  /** Kisa servis adi; gunluk alani ve acilis kaydi icin (orn. "catalog"). */
  readonly serviceName: string;
  /** Dinlenecek port. 0 verilirse isletim sistemi bos bir port secer (testler). */
  readonly port: number;
  readonly host?: string;
  readonly services: readonly GrpcServiceRegistration[];
  readonly logger?: Logger;
  /** Devam eden cagrilar icin beklenecek en uzun sure (ms). */
  readonly shutdownTimeoutMs?: number;
  /** Sunucu kapandiktan SONRA calisir: Mongo/Redis baglantilarini kapatir. */
  readonly onShutdown?: () => Promise<void> | void;
}

export interface GrpcServerHandle {
  /** Gercekten baglanilan port (port 0 verildiginde isletim sisteminin sectigi). */
  readonly port: number;
  /** Durum tablosu; servis kendi bagimliliklarina gore guncelleyebilir. */
  readonly health: HealthService;
  /** Zarif kapanis. Birden cok kez cagrilabilir; ilk cagri disindakiler ayni sozu bekler. */
  shutdown(reason: string): Promise<void>;
}

/** Sunucuyu kurar, portu acar ve health durumunu SERVING'e cevirir. */
export async function startGrpcServer(options: GrpcServerOptions): Promise<GrpcServerHandle> {
  const logger = (options.logger ?? silentLogger).child({ service: options.serviceName });
  const host = options.host ?? DEFAULT_GRPC_HOST;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  const server = new Server();
  const health = new HealthService(logger);
  server.addService(healthServiceDefinition, health.implementation);

  for (const registration of options.services) {
    server.addService(registration.definition, registration.implementation);
    if (registration.name !== undefined) {
      health.setStatus(registration.name, SERVING_STATUS.NOT_SERVING);
    }
  }

  const port = await bind(server, host, options.port);

  health.setStatus(OVERALL_HEALTH_KEY, SERVING_STATUS.SERVING);
  for (const registration of options.services) {
    if (registration.name !== undefined) {
      health.setStatus(registration.name, SERVING_STATUS.SERVING);
    }
  }
  logger.info({ host, port, services: options.services.length }, 'gRPC sunucusu dinlemede');

  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (reason: string): Promise<void> => {
    // Ikinci SIGTERM ya da paralel bir cagri kapanisi BASTAN baslatmamali;
    // forceShutdown iki kez cagrilirsa grpc-js hata firlatir.
    shutdownPromise ??= runShutdown({
      server,
      health,
      services: options.services,
      logger,
      reason,
      timeoutMs: shutdownTimeoutMs,
      ...(options.onShutdown === undefined ? {} : { onShutdown: options.onShutdown }),
    });
    return shutdownPromise;
  };

  return { port, health, shutdown };
}

/** bindAsync'i sozle sarar; port 0 verildiginde gercek portu dondurur. */
function bind(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.bindAsync(`${host}:${port}`, ServerCredentials.createInsecure(), (error, boundPort) => {
      if (error) {
        // En sik sebep: port kullanimda (ayni servis iki kez acilmis) ya da
        // ayricalikli port. Mesaji oldugu gibi tasiyoruz, tahmin etmiyoruz.
        reject(
          AppError.internal(`gRPC portu acilamadi: ${host}:${port} - ${error.message}`, {
            cause: error,
          }),
        );
        return;
      }
      resolve(boundPort);
    });
  });
}

interface ShutdownParams {
  readonly server: Server;
  readonly health: HealthService;
  readonly services: readonly GrpcServiceRegistration[];
  readonly logger: Logger;
  readonly reason: string;
  readonly timeoutMs: number;
  readonly onShutdown?: () => Promise<void> | void;
}

async function runShutdown(params: ShutdownParams): Promise<void> {
  const { server, health, logger, reason, timeoutMs } = params;
  logger.info({ reason, timeoutMs }, 'zarif kapanis basladi');

  health.setStatus(OVERALL_HEALTH_KEY, SERVING_STATUS.NOT_SERVING);
  for (const registration of params.services) {
    if (registration.name !== undefined) {
      health.setStatus(registration.name, SERVING_STATUS.NOT_SERVING);
    }
  }
  health.closeWatchers();

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
