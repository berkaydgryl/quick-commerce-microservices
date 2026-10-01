/**
 * Servisin metrik ucu (T10.5): gRPC portu + 1000'de HTTP /metrics (roadmap
 * port haritasi; catalog 50051 -> 51051).
 *
 * startGrpcServer acar, zarif kapanis kapatir; servis kodu bir sey yapmaz.
 * Burada yalnizca port kurali ve acilis adimlari (`service` etiketi, surec
 * metrikleri) durur. HTTP ucunun kendisi @getir/observability'dedir.
 */

import { AppError } from '@getir/core';
import { enableProcessMetrics, setServiceLabel, startMetricsServer } from '@getir/observability';
import type { MetricsServer } from '@getir/observability';

import { METRICS_PORT_OFFSET } from '../config/constants.js';
import { MAX_PORT } from '../config/env.js';
import type { Logger } from '../logger.js';

export interface MetricsEndpointOptions {
  /** Kisa servis adi; her metrikte `service` etiketi olur. */
  readonly serviceName: string;
  /** gRPC ile ayni adres: konteynerde 0.0.0.0. */
  readonly host: string;
  /** ISTENEN gRPC portu (baglanilan degil): 0 ise metrik ucu da bos bir portta acilir. */
  readonly grpcPort: number;
  readonly logger: Logger;
}

/** Kural: gRPC portu + 1000. gRPC portu 0 ise (testler) 0: isletim sistemi secer. */
export function metricsPortFor(grpcPort: number): number {
  return grpcPort === 0 ? 0 : grpcPort + METRICS_PORT_OFFSET;
}

/** `service` etiketini koyar, surec metriklerini acar ve ucu dinlemeye baslar. */
export async function openMetricsEndpoint(options: MetricsEndpointOptions): Promise<MetricsServer> {
  const port = metricsPortFor(options.grpcPort);
  if (port > MAX_PORT) {
    // Ortam semasi (grpcPort) bunu zaten engeller; kodla verilen port icin son kapi.
    throw AppError.internal(
      `metrik portu ${port} gecersiz: gRPC portu en fazla ${MAX_PORT - METRICS_PORT_OFFSET}`,
    );
  }
  setServiceLabel(options.serviceName);
  enableProcessMetrics();
  try {
    return await startMetricsServer({ host: options.host, port, logger: options.logger });
  } catch (error: unknown) {
    // En sik sebep: port kullanimda (ayni servis iki kez acilmis). Mesaj oldugu gibi.
    const reason = error instanceof Error ? error.message : String(error);
    throw AppError.internal(`metrik portu acilamadi: ${options.host}:${port} - ${reason}`, {
      cause: error,
    });
  }
}
