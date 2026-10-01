/**
 * gRPC sunucusunun ACILISI.
 *
 * Bir Node servisinin `bootstrap.ts` dosyasinin yaptigi is buraya iner:
 * sunucuyu kur, health servisini bagla, portu ac, metrik ucunu ac (T10.5),
 * durumu SERVING'e cevir ve cagirana bir kapanis dugmesi (handle.shutdown) ver.
 *
 * Kapanisin KENDISI burada degil: graceful-shutdown.ts icindedir. Burasi
 * yalnizca onu tek seferlik calisacak sekilde baglar.
 */

import { AppError } from '@getir/core';
import type { MetricsServer } from '@getir/observability';
import { Server, ServerCredentials } from '@grpc/grpc-js';

import {
  DEFAULT_GRPC_HOST,
  DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  OVERALL_HEALTH_KEY,
  SERVING_STATUS,
} from '../config/constants.js';
import { HealthRegistry } from '../health/registry.js';
import { silentLogger } from '../logger.js';
import { runGracefulShutdown } from './graceful-shutdown.js';
import { routeGrpcJsLogs } from './grpc-logging.js';
import { HealthGrpcService, healthServiceDefinition } from './health.js';
import { openMetricsEndpoint } from './metrics-endpoint.js';
import type { GrpcServerHandle, GrpcServerOptions } from './types.js';

/** Sunucuyu kurar, gRPC portunu ve metrik ucunu acar, health durumunu SERVING'e cevirir. */
export async function startGrpcServer(options: GrpcServerOptions): Promise<GrpcServerHandle> {
  const logger = (options.logger ?? silentLogger).child({ service: options.serviceName });
  // Portu acmadan ONCE: dolu porttaki grpc-js satiri da JSON olarak yazilsin (D5).
  routeGrpcJsLogs(logger);
  const host = options.host ?? DEFAULT_GRPC_HOST;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const hookTimeoutMs = options.shutdownHookTimeoutMs ?? DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS;

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
  const metrics = await openMetrics(server, {
    serviceName: options.serviceName,
    host,
    grpcPort: options.port,
    logger,
  });

  health.setStatus(OVERALL_HEALTH_KEY, SERVING_STATUS.SERVING);
  for (const registration of options.services) {
    if (registration.name !== undefined) {
      health.setStatus(registration.name, SERVING_STATUS.SERVING);
    }
  }
  logger.info(
    { host, port, metricsPort: metrics.port, services: options.services.length },
    'gRPC sunucusu dinlemede',
  );

  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (reason: string): Promise<void> => {
    // Ikinci SIGTERM ya da paralel bir cagri kapanisi BASTAN baslatmamali;
    // forceShutdown iki kez cagrilirsa grpc-js hata firlatir.
    shutdownPromise ??= runGracefulShutdown({
      server,
      health,
      healthGrpc,
      services: options.services,
      metrics,
      logger,
      reason,
      timeoutMs: shutdownTimeoutMs,
      hookTimeoutMs,
      ...(options.onShutdown === undefined ? {} : { onShutdown: options.onShutdown }),
    });
    return shutdownPromise;
  };

  return { port, metricsPort: metrics.port, health, shutdown };
}

/** Metrik ucunu acar; acamazsa acilmis gRPC sunucusu askida kalmasin diye kapatir. */
async function openMetrics(
  server: Server,
  options: Parameters<typeof openMetricsEndpoint>[0],
): Promise<MetricsServer> {
  try {
    return await openMetricsEndpoint(options);
  } catch (error: unknown) {
    server.forceShutdown();
    throw error;
  }
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
