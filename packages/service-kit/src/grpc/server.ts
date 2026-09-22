/**
 * gRPC sunucusunun ACILISI.
 *
 * Bir Node servisinin `bootstrap.ts` dosyasinin yaptigi is buraya iner:
 * sunucuyu kur, health servisini bagla, portu ac, durumu SERVING'e cevir ve
 * cagirana bir kapanis dugmesi (handle.shutdown) ver.
 *
 * Kapanisin KENDISI burada degil: graceful-shutdown.ts icindedir. Burasi
 * yalnizca onu tek seferlik calisacak sekilde baglar.
 */

import { AppError } from '@getir/core';
import { Server, ServerCredentials } from '@grpc/grpc-js';

import {
  DEFAULT_GRPC_HOST,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  OVERALL_HEALTH_KEY,
  SERVING_STATUS,
} from '../config/constants.js';
import { HealthRegistry } from '../health/registry.js';
import { silentLogger } from '../logger.js';
import { runGracefulShutdown } from './graceful-shutdown.js';
import { HealthGrpcService, healthServiceDefinition } from './health.js';
import type { GrpcServerHandle, GrpcServerOptions } from './types.js';

/** Sunucuyu kurar, portu acar ve health durumunu SERVING'e cevirir. */
export async function startGrpcServer(options: GrpcServerOptions): Promise<GrpcServerHandle> {
  const logger = (options.logger ?? silentLogger).child({ service: options.serviceName });
  const host = options.host ?? DEFAULT_GRPC_HOST;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  const server = new Server();
  const health = new HealthRegistry(logger);
  const healthGrpc = new HealthGrpcService(health, logger);
  server.addService(healthServiceDefinition, healthGrpc.implementation);

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
    shutdownPromise ??= runGracefulShutdown({
      server,
      health,
      healthGrpc,
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
