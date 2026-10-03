/**
 * Saglik ucu (D7): GET /healthz, Socket.io ile ayni portta (3001).
 *
 *   hazir            -> 200 {"status":"SERVING"}
 *   hazir degil      -> 503 {"status":"NOT_SERVING"} (Redis baglantisi yok ya da kapanis basladi)
 *   /healthz'e baska fiil -> 405 (Allow: GET)
 *   baska her yol    -> 404
 *
 * Socket.io yalnizca kendi yolunu (/socket.io) karsilar, gerisini bu isleyiciye
 * birakir. Yanit kisisel veri ve ayrinti tasimaz; Docker HEALTHCHECK ve yuk
 * dengeleyici yalnizca durum koduna bakar. Saglik yoklamasi izlenmez (ADR-20).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { HTTP_STATUS } from '@getir/core';
import type { HttpStatus } from '@getir/core';
import { SERVING_STATUS } from '@getir/service-kit';

import { HEALTH_PATH } from '../../config/constants.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export interface HealthDeps {
  /** Kopya trafik almaya hazir mi? I/O yapmaz. */
  isReady(): boolean;
}

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

export function createHealthHandler(deps: HealthDeps): RequestHandler {
  return (request, response) => {
    if (pathOf(request.url) !== HEALTH_PATH) {
      reply(response, HTTP_STATUS.NOT_FOUND, { error: 'bulunamadi' });
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      reply(response, HTTP_STATUS.METHOD_NOT_ALLOWED, { error: 'yalnizca GET' });
      return;
    }
    const ready = deps.isReady();
    reply(response, ready ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE, {
      status: ready ? SERVING_STATUS.SERVING : SERVING_STATUS.NOT_SERVING,
    });
  };
}

/** Sorgu dizesi yolu degistirmez: `/healthz?x=1` de `/healthz`'dir. */
function pathOf(url: string | undefined): string {
  return (url ?? '/').split('?', 1)[0] ?? '/';
}

function reply(response: ServerResponse, status: HttpStatus, body: Record<string, string>): void {
  response.writeHead(status, { 'Content-Type': JSON_CONTENT_TYPE });
  response.end(JSON.stringify(body));
}
