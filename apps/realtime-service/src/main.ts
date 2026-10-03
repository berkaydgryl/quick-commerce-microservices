/**
 * Realtime servisinin giris noktasi: process yasam dongusu.
 *
 * Calistirma:
 *   pnpm --filter @getir/realtime-service build
 *   pnpm --filter @getir/realtime-service start      (kok .env varsa okunur)
 *
 * MOCK=true: Redis'siz, bellek adapter'i (tek kopya), olay dinleme kapali (D10);
 * REALTIME_TOKEN_SECRET yoksa siparis odalari kapali. MOCK=false: REDIS_URL ve
 * REALTIME_TOKEN_SECRET zorunlu; order.status_changed dinlenir (T12.3).
 *
 * Dogrulama:
 *   curl -s localhost:3001/healthz          -> {"status":"SERVING"}
 *   curl -s localhost:4001/metrics | grep realtime_
 */

import { hostname } from 'node:os';

import { createLogger, installProcessHandlers, startOrExit } from '@getir/service-kit';

import { startRealtimeServer } from './bootstrap.js';
import { CONSUMER_HOST_MAX_LENGTH, DEFAULT_HOST, SERVICE_NAME } from './config/constants.js';
import { loadServiceEnv } from './config/env.js';
import { startEventConsuming } from './events.js';
import { openRedisAdapter } from './infrastructure/redis-adapter.js';

const env = loadServiceEnv();
const logger = createLogger({ name: SERVICE_NAME, level: env.LOG_LEVEL });

// Acilis adimlari (Redis, port, metrik ucu) sarilir: biri basarisizsa hata duz
// metin yigin izi yerine tek satir fatal JSON olarak yazilir ve process kapanir.
const server = await startOrExit(
  async () => {
    const redis = env.redis;
    const adapter = redis === undefined ? undefined : await openRedisAdapter({ redis, logger });
    try {
      return await startRealtimeServer({
        host: DEFAULT_HOST,
        port: env.REALTIME_PORT,
        logger,
        tokenSecret: env.REALTIME_TOKEN_SECRET,
        otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
        ...(redis === undefined || adapter === undefined
          ? {}
          : {
              adapter,
              // Tuketici adi surece tekildir (makine + pid): kopyalar grupta isi paylasir.
              events: (broadcast) =>
                startEventConsuming(
                  {
                    redis,
                    adapter,
                    consumerName: `${hostname().slice(0, CONSUMER_HOST_MAX_LENGTH)}-${process.pid}`,
                    logger,
                  },
                  broadcast,
                ),
            }),
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
    events: env.redis === undefined ? 'kapali (MOCK)' : 'order.status_changed',
  },
  'realtime servisi hazir',
);
