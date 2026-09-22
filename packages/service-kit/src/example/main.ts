/**
 * Ornek servisin giris noktasi.
 *
 * Calistirma:
 *   pnpm --filter @getir/service-kit build
 *   pnpm --filter @getir/service-kit example
 *
 * Dogrulama (grpcurl, ayri bir kabukta):
 *   grpcurl -plaintext -proto packages/service-kit/proto/health.proto \
 *     -d '{"service":""}' localhost:50099 grpc.health.v1.Health/Check
 *
 * Bu dosya ayni zamanda her servisin `main.ts`'i icin SABLONDUR: env oku,
 * gunlukcuyu kur, sunucuyu ac, process kancalarini bagla. Baska is yapmaz.
 */

import { createLogger } from '../logger.js';
import { installProcessHandlers } from '../shutdown.js';
import { startGrpcServer } from '../grpc/server.js';
import {
  createEchoImplementation,
  echoServiceDefinition,
  ECHO_SERVICE_NAME,
} from './echo-service.js';
import { env } from './env.js';

const SERVICE_NAME = 'example';

const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

const handle = await startGrpcServer({
  serviceName: SERVICE_NAME,
  host: env.GRPC_HOST,
  port: env.EXAMPLE_GRPC_PORT,
  shutdownTimeoutMs: env.GRPC_SHUTDOWN_TIMEOUT_MS,
  logger,
  services: [
    {
      name: ECHO_SERVICE_NAME,
      definition: echoServiceDefinition,
      implementation: createEchoImplementation(`${SERVICE_NAME}@${process.pid}`, logger),
    },
  ],
});

installProcessHandlers({ shutdown: (reason) => handle.shutdown(reason), logger });

logger.info({ port: handle.port, mock: env.MOCK }, 'ornek servis hazir');
