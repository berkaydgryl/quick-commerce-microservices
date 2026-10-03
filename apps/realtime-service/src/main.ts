/**
 * Realtime servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/realtime-service build
 *   pnpm --filter @getir/realtime-service start      (kok .env varsa okunur)
 *
 * MOCK=true: Redis'siz, bellek adapter'i (tek kopya); REALTIME_TOKEN_SECRET yoksa
 * siparis odalari kapali. MOCK=false: REDIS_URL ve REALTIME_TOKEN_SECRET zorunlu.
 *
 * Dogrulama:
 *   curl -s localhost:3001/healthz          -> {"status":"SERVING"}
 *   curl -s localhost:4001/metrics | grep realtime_
 */

import { createLogger, installProcessHandlers, startOrExit } from '@getir/service-kit';

import { startRealtimeServer } from './bootstrap.js';
import { DEFAULT_HOST, SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { openRedisAdapter } from './infrastructure/redis-adapter.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

// Acilis adimlari (Redis, port, metrik ucu) sarilir: biri basarisizsa hata duz
// metin yigin izi yerine tek satir fatal JSON olarak yazilir ve process kapanir.
const server = await startOrExit(
  async () => {
    const adapter =
      env.redis === undefined ? undefined : await openRedisAdapter({ redis: env.redis, logger });
    try {
      return await startRealtimeServer({
        host: DEFAULT_HOST,
        port: env.REALTIME_PORT,
        logger,
        tokenSecret: env.REALTIME_TOKEN_SECRET,
        ...(adapter === undefined ? {} : { adapter }),
        otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      });
    } catch (error: unknown) {
      // Port acilamadiysa Redis baglantilari askida kalmasin.
      await adapter?.close();
      throw error;
    }
  },
  { logger },
);

installProcessHandlers({ shutdown: (reason) => server.shutdown(reason), logger });

if (env.REALTIME_TOKEN_SECRET === undefined) {
  logger.warn({}, 'REALTIME_TOKEN_SECRET yok: siparis odalari kapali (yalnizca MOCK)');
}
logger.info(
  {
    port: server.port,
    metricsPort: server.metricsPort,
    mock: env.MOCK,
    adapter: env.redis === undefined ? 'memory' : 'redis',
  },
  'realtime servisi hazir',
);
