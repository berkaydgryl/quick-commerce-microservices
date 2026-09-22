/**
 * Standart gRPC health servisi (grpc.health.v1.Health).
 *
 * NEDEN STANDART SOZLESME: durum sorgusunu kendimiz uydursaydik (orn.
 * getir.common.v1.Ping) grpcurl'un, Kubernetes'in grpc probe'unun ve Go
 * istemcisinin hazir arayuzleri ise yaramazdi. Bu paketin proto/health.proto
 * dosyasi yukari akistaki dosyanin birebir kopyasidir.
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

/**
 * Sunucudaki servislerin ayakta olma durumunu tutar ve health RPC'sini uygular.
 */
export class HealthService {
  private readonly statuses = new Map<string, ServingStatus>();
  private readonly watchers = new Map<string, Set<HealthWatchStream>>();
  private readonly logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.logger = logger;
    // Sunucu daha dinlemeye baslamadan "ayakta" demek YANLIS olurdu; ilk durum
    // NOT_SERVING'dir, bind basarili olunca SERVING'e cevrilir.
    this.statuses.set(OVERALL_HEALTH_KEY, SERVING_STATUS.NOT_SERVING);
  }

  /** Servisin (veya bos anahtarla butun sunucunun) durumunu gunceller. */
  setStatus(service: string, status: ServingStatus): void {
    if (this.statuses.get(service) === status) {
      return;
    }
    this.statuses.set(service, status);
    // Alan adi "service" DEGIL: sunucunun gunlukcusu zaten { service: 'catalog' }
    // baglamiyla geliyor ve ayni JSON'da iki "service" anahtari olusuyordu.
    this.logger?.info({ target: service || '(sunucu)', status }, 'health durumu degisti');

    for (const stream of this.watchers.get(service) ?? []) {
      stream.write({ status });
    }
  }

  /** Kayitli durum; servis hic bildirilmediyse undefined. */
  getStatus(service: string): ServingStatus | undefined {
    return this.statuses.get(service);
  }

  /** Tum Watch akislarini kapatir. Kapanista cagrilmazsa sunucu asla bosalmaz. */
  closeWatchers(): void {
    for (const streams of this.watchers.values()) {
      for (const stream of streams) {
        stream.end();
      }
      streams.clear();
    }
    this.watchers.clear();
  }

  /** grpc-js'e verilecek uygulama nesnesi. */
  get implementation(): UntypedServiceImplementation {
    return {
      Check: unaryHandler({
        name: 'Health.Check',
        schema: healthCheckRequestSchema,
        handle: ({ service }): HealthCheckResponse => {
          const status = this.statuses.get(service);
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
        const current = this.statuses.get(service) ?? SERVING_STATUS.SERVICE_UNKNOWN;
        stream.write({ status: current });

        const streams = this.watchers.get(service) ?? new Set<HealthWatchStream>();
        streams.add(stream);
        this.watchers.set(service, streams);

        const forget = (): void => {
          streams.delete(stream);
        };
        stream.on('cancelled', forget);
        stream.on('close', forget);
        stream.on('error', forget);
      },
    };
  }
}
