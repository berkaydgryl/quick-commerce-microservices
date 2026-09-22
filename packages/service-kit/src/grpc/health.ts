/**
 * Standart gRPC health servisi (grpc.health.v1.Health) - TASIMA katmani.
 *
 * NEDEN STANDART SOZLESME: durum sorgusunu kendimiz uydursaydik (orn.
 * getir.common.v1.Ping) grpcurl'un, Kubernetes'in grpc probe'unun ve Go
 * istemcisinin hazir arayuzleri ise yaramazdi. Bu paketin proto/health.proto
 * dosyasi yukari akistaki dosyanin birebir kopyasidir.
 *
 * SORUMLULUK SINIRI: bu dosya DURUM TUTMAZ. Durum HealthRegistry'dedir
 * (src/health/registry.ts); burasi yalnizca o defteri gRPC'ye acar ve Watch
 * akislarinin yasam dongusunu yonetir.
 *
 * DURUM NEREDEN GELIR: sunucu acilisinda SERVING, kapanis basladiginda
 * NOT_SERVING yazilir (bkz. server.ts). Servisler ayrica kendi bagimliliklarina
 * gore (Mongo koptu, Redis yok) durumu elle degistirebilir:
 *   handle.health.setStatus('getir.catalog.v1.CatalogService', 'NOT_SERVING');
 */

import { fileURLToPath } from 'node:url';

import { AppError } from '@getir/core';
import type {
  ServerWritableStream,
  ServiceDefinition,
  UntypedServiceImplementation,
} from '@grpc/grpc-js';
import { z } from 'zod';

import { HEALTH_SERVICE_NAME, OVERALL_HEALTH_KEY, SERVING_STATUS } from '../config/constants.js';
import type { ServingStatus } from '../config/constants.js';
import type { HealthRegistry, Unsubscribe } from '../health/registry.js';
import type { Logger } from '../logger.js';
import { unaryHandler } from './handler.js';
import { loadServiceDefinition } from './proto.js';

/** Health sorgusu: bos servis adi "butun sunucu" demektir. */
const healthCheckRequestSchema = z.object({
  service: z.string().default(OVERALL_HEALTH_KEY),
});

export interface HealthCheckResponse {
  status: ServingStatus;
}

/** Watch akisinin sunucu tarafi; her durum degisiminde yeni mesaj yazilir. */
type HealthWatchStream = ServerWritableStream<{ service?: string }, HealthCheckResponse>;

const HEALTH_PROTO_PATH = fileURLToPath(new URL('../../proto/health.proto', import.meta.url));

/** grpc.health.v1.Health servis tanimi (modul yuklenirken bir kez okunur). */
export const healthServiceDefinition: ServiceDefinition = loadServiceDefinition(
  HEALTH_PROTO_PATH,
  HEALTH_SERVICE_NAME,
);

/** Health RPC'sinin gRPC uygulamasi ve acik akislarinin sahibi. */
export class HealthGrpcService {
  private readonly registry: HealthRegistry;
  private readonly logger: Logger | undefined;
  /** Acik Watch akislari ve her birinin dinleme iptali. */
  private readonly streams = new Map<HealthWatchStream, Unsubscribe>();

  constructor(registry: HealthRegistry, logger?: Logger) {
    this.registry = registry;
    this.logger = logger;
  }

  /** Tum Watch akislarini kapatir. Kapanista cagrilmazsa sunucu asla bosalmaz. */
  closeWatchers(): void {
    for (const [stream, unsubscribe] of this.streams) {
      unsubscribe();
      stream.end();
    }
    this.streams.clear();
  }

  /** grpc-js'e verilecek uygulama nesnesi. */
  get implementation(): UntypedServiceImplementation {
    return {
      Check: unaryHandler({
        name: 'Health.Check',
        schema: healthCheckRequestSchema,
        handle: ({ service }): HealthCheckResponse => {
          const status = this.registry.getStatus(service);
          if (status === undefined) {
            // Standart boyle ister: bilinmeyen servis Check'te NOT_FOUND ile
            // duser (Watch'ta ise SERVICE_UNKNOWN mesaji yazilir).
            throw AppError.notFound(`Bilinmeyen servis: ${service || '(sunucu)'}`);
          }
          return { status };
        },
        ...(this.logger === undefined ? {} : { logger: this.logger }),
      }),

      Watch: (stream: HealthWatchStream): void => {
        const service = stream.request.service ?? OVERALL_HEALTH_KEY;
        stream.write({
          status: this.registry.getStatus(service) ?? SERVING_STATUS.SERVICE_UNKNOWN,
        });

        const unsubscribe = this.registry.subscribe(service, (status) => {
          stream.write({ status });
        });
        this.streams.set(stream, unsubscribe);

        const forget = (): void => {
          unsubscribe();
          this.streams.delete(stream);
        };
        stream.on('cancelled', forget);
        stream.on('close', forget);
        stream.on('error', forget);
      },
    };
  }
}
