/**
 * HTTP /metrics ucu (T10.5): Prometheus'un kazidigi (scrape) tek yol.
 *
 * Node'un kendi http modulu; tek yol ve tek fiil icin web catisi gerekmez:
 *   GET /metrics            -> 200, Prometheus metin bicimi
 *   /metrics'e baska fiil   -> 405 (Allow: GET)
 *   baska her yol           -> 404
 *
 * Kapanis yeni baglantiyi keser, bosta bekleyen (keep-alive) baglantilari
 * kapatir ve suren cevabi bekler; METRICS_CLOSE_GRACE_MS icinde bitmeyen
 * baglanti kesilir (yarim istekle bekleyen istemci kapanisi kilitlemesin).
 * Kapanis hata firlatmaz ve birden cok kez cagrilabilir.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { HTTP_STATUS, silentLogger } from '@getir/core';
import type { HttpStatus, Logger } from '@getir/core';

import { metricsRegistry } from './registry.js';
import type { Registry } from './registry.js';

/** Kazima yolu (roadmap port haritasi: servis portu + 1000, HTTP /metrics). */
export const METRICS_PATH = '/metrics';

/** Kapanista suren cevaba taninan en uzun sure; sonra baglanti kesilir. */
export const METRICS_CLOSE_GRACE_MS = 1_000;

const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

export interface MetricsServerOptions {
  readonly host: string;
  /** 0: isletim sistemi bos bir port secer (testler). */
  readonly port: number;
  readonly logger?: Logger;
  /** Verilmezse surecin defteri (metricsRegistry). */
  readonly registry?: Registry;
}

export interface MetricsServer {
  /** Gercekten dinlenen port (0 verildiginde isletim sisteminin sectigi). */
  readonly port: number;
  /** Ucu kapatir; hata firlatmaz, ikinci cagri ayni sozu doner. */
  close(): Promise<void>;
}

/** Ucu acar. Port aciklamazsa (kullanimda) dinleme hatasiyla reddedilir. */
export async function startMetricsServer(options: MetricsServerOptions): Promise<MetricsServer> {
  const registry = options.registry ?? metricsRegistry;
  const logger = options.logger ?? silentLogger;
  const server = createServer((request, response) => {
    void respond(request, response, registry, logger);
  });
  const port = await listen(server, options.host, options.port);
  // Dinlerken gelen sunucu hatasi (orn. dosya tanimlayicisi tukendi) processi devirmesin.
  const onError = (error: Error): void => {
    logger.error({ err: error }, 'metrik sunucusu hatasi');
  };
  server.on('error', onError);

  let closing: Promise<void> | undefined;
  return {
    port,
    close: () => {
      closing ??= closeServer(server).finally(() => {
        server.off('error', onError);
      });
      return closing;
    },
  };
}

async function respond(
  request: IncomingMessage,
  response: ServerResponse,
  registry: Registry,
  logger: Logger,
): Promise<void> {
  if (pathOf(request.url) !== METRICS_PATH) {
    reply(response, HTTP_STATUS.NOT_FOUND, 'bulunamadi');
    return;
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    reply(response, HTTP_STATUS.METHOD_NOT_ALLOWED, 'yalnizca GET');
    return;
  }
  try {
    const body = await registry.metrics();
    response.writeHead(HTTP_STATUS.OK, { 'Content-Type': registry.contentType });
    response.end(body);
  } catch (error: unknown) {
    logger.error({ err: error }, 'metrikler toplanamadi');
    reply(response, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'metrikler toplanamadi');
  }
}

/** Sorgu dizesi yolu degistirmez: `/metrics?x=1` de `/metrics`'tir. */
function pathOf(url: string | undefined): string {
  return (url ?? '/').split('?', 1)[0] ?? '/';
}

function reply(response: ServerResponse, status: HttpStatus, text: string): void {
  response.writeHead(status, { 'Content-Type': TEXT_CONTENT_TYPE });
  response.end(`${text}\n`);
}

/** listen'i soze sarar; port 0 verildiginde gercek portu doner. */
function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onListenError = (error: Error): void => {
      reject(error);
    };
    server.once('error', onListenError);
    server.listen(port, host, () => {
      server.off('error', onListenError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        // TCP dinleyen sunucuda olmaz; olursa portu bilinmeyen uc acik kalmasin.
        server.close();
        reject(new Error(`metrik sunucusu adresi okunamadi: ${String(address)}`));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
    }, METRICS_CLOSE_GRACE_MS);
    // Kapanis erken biterse sayac surec omrunu uzatmasin.
    timer.unref();
    // Dinlemiyorsa (zaten kapali) geri cagri hatayla gelir: kapanis yine tamamdir.
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
}
