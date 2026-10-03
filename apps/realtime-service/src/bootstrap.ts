/**
 * Realtime sunucusunun kurulumu ve acilisi (DI framework yok).
 *
 * Sira: izler (D15) -> jeton dogrulayici -> HTTP sunucusu (saglik ucu) ->
 * Socket.io -> port -> metrik ucu (port + 1000, T10.5) -> yayin kapisi. Kapanis
 * dugmesi (shutdown) tek seferliktir; ikinci cagri ayni sozu doner.
 *
 * Testler ve main.ts ayni fonksiyonu cagirir: Redis adapter'i verilirse kopyalar
 * odalari paylasir, verilmezse bellek adapter'i (tek kopya).
 */

import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';

import { systemClock } from '@getir/core';
import type { Clock, Logger } from '@getir/core';
import {
  enableProcessMetrics,
  METRICS_CLOSE_GRACE_MS,
  setServiceLabel,
  startMetricsServer,
  startTracing,
  TRACE_FLUSH_TIMEOUT_MS,
} from '@getir/observability';
import type { MetricsServer } from '@getir/observability';
import {
  DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  metricsPortFor,
} from '@getir/service-kit';
import type { Server } from 'socket.io';

import { createBroadcast } from './application/broadcast.js';
import type { Broadcast } from './application/broadcast.js';
import { createJoinRoom } from './application/join-room.js';
import { SERVICE_NAME } from './config/constants.js';
import type { RedisAdapterHandle } from './infrastructure/redis-adapter.js';
import {
  createRoomTokenVerifier,
  disabledRoomTokenVerifier,
} from './infrastructure/room-token-verifier.js';
import { createHealthHandler } from './interfaces/http/health.js';
import { realtimeMetrics } from './interfaces/metrics.js';
import { runShutdown } from './interfaces/shutdown.js';
import { createSocketServer } from './interfaces/socket/socket-server.js';

export interface RealtimeServerOptions {
  readonly host: string;
  /** 0: isletim sistemi bos bir port secer (testler); metrik ucu da bos portta acilir. */
  readonly port: number;
  readonly logger: Logger;
  /** Oda jetonu sirri; verilmezse siparis odalari kapali (yalnizca MOCK, D3). */
  readonly tokenSecret: string | undefined;
  /** Verilmezse bellek adapter'i (tek kopya). */
  readonly adapter?: RedisAdapterHandle;
  readonly otlpEndpoint?: string | undefined;
  /** Saat; testte sabitlenebilsin diye disaridan verilebilir. */
  readonly clock?: Clock;
  /** Socket.io kapanisinin ust siniri (ms). */
  readonly shutdownTimeoutMs?: number;
}

export interface RealtimeServer {
  /** Gercekten dinlenen port. */
  readonly port: number;
  readonly metricsPort: number;
  /** Odaya yayin kapisi (T12.3'teki tuketici kullanacak). */
  readonly broadcast: Broadcast;
  /** Zarif kapanis; hata firlatmaz, ikinci cagri ayni sozu doner. */
  shutdown(reason: string): Promise<void>;
}

export async function startRealtimeServer(options: RealtimeServerOptions): Promise<RealtimeServer> {
  const logger = options.logger.child({ service: SERVICE_NAME });
  const clock = options.clock ?? systemClock;
  // Port acilmadan ONCE: ilk room.join'in span'i da kaydedilsin.
  const tracing = startTracing({
    serviceName: SERVICE_NAME,
    otlpEndpoint: options.otlpEndpoint,
    logger,
  });
  const verifier =
    options.tokenSecret === undefined
      ? disabledRoomTokenVerifier
      : createRoomTokenVerifier({ secret: options.tokenSecret, clock });

  let closing = false;
  const httpServer = createServer(
    createHealthHandler({ isReady: () => !closing && (options.adapter?.isReady() ?? true) }),
  );
  const io = createSocketServer({
    httpServer,
    ...(options.adapter === undefined ? {} : { adapter: options.adapter.adapter }),
    joinRoom: createJoinRoom({ verifier }),
    logger,
    metrics: realtimeMetrics,
    clock,
  });

  const port = await listen(httpServer, options.host, options.port);
  const metrics = await openMetrics(io, { host: options.host, port: options.port, logger });
  logger.info({ host: options.host, port, metricsPort: metrics.port }, 'realtime dinlemede');

  let shutdownPromise: Promise<void> | undefined;
  return {
    port,
    metricsPort: metrics.port,
    broadcast: createBroadcast({
      emitter: {
        emit: (room, event, payload) => {
          io.to(room).emit(event, payload);
        },
      },
      metrics: realtimeMetrics,
      logger,
    }),
    shutdown: (reason) => {
      shutdownPromise ??= (async () => {
        logger.info({ reason }, 'realtime kapaniyor');
        closing = true;
        await runShutdown(
          [
            {
              name: 'socket.io',
              run: () => io.close(),
              timeoutMs: options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
            },
            {
              name: 'redis',
              run: () => options.adapter?.close() ?? Promise.resolve(),
              timeoutMs: DEFAULT_SHUTDOWN_HOOK_TIMEOUT_MS,
            },
            {
              name: 'metrik ucu',
              run: () => metrics.close(),
              timeoutMs: 2 * METRICS_CLOSE_GRACE_MS,
            },
            { name: 'izler', run: () => tracing.flush(), timeoutMs: 2 * TRACE_FLUSH_TIMEOUT_MS },
          ],
          logger,
        );
        logger.info({ reason }, 'realtime kapandi');
      })();
      return shutdownPromise;
    },
  };
}

/** Metrik ucunu acar (port + 1000); acamazsa acilmis sunucu askida kalmasin diye kapatir. */
async function openMetrics(
  io: Server,
  options: { readonly host: string; readonly port: number; readonly logger: Logger },
): Promise<MetricsServer> {
  setServiceLabel(SERVICE_NAME);
  enableProcessMetrics();
  try {
    return await startMetricsServer({
      host: options.host,
      port: metricsPortFor(options.port),
      logger: options.logger,
    });
  } catch (error: unknown) {
    await io.close();
    throw error;
  }
}

/** listen'i soze sarar; port 0 verildiginde gercek portu doner. */
function listen(server: HttpServer, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error(`realtime adresi okunamadi: ${String(address)}`));
        return;
      }
      resolve(address.port);
    });
  });
}
