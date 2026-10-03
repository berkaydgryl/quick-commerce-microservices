/**
 * Socket.io sunucusu (T12.1): baglanti, room.join ve ack.
 *
 * Handler incedir: govdeyi use-case'e verir (createJoinRoom), sonucu sokete
 * uygular (socket.join), sayaci ve gunlugu yazar, ack doner. Kural burada yok.
 *
 * Tasima YALNIZCA websocket (D2): HTTP yoklamasi (polling) kapali. Yoklama, ayni
 * istemcinin ardisik isteklerinin hep ayni kopyaya gitmesini (yapiskan oturum)
 * gerektirir; websocket tek uzun baglantidir ve yuk dengeleyicide ek ayar
 * istemez (ADR-06 eki). Istemci `transports: ['websocket']` ile baglanmalidir.
 *
 * Korelasyon kimligi BAGLANTI basinadir: el sikismadaki `x-request-id` basligi
 * yalnizca bicime uyarsa kabul edilir, degilse uretilir (#22, gateway kurali).
 * Tarayici websocket'e baslik ekleyemedigi icin web'de kimlik hep sunucuda uretilir.
 */

import type { Server as HttpServer } from 'node:http';

import { SOCKET_EVENTS } from '@getir/contracts';
import { ERROR_CODES, ERROR_SEVERITY, errorSeverityFor } from '@getir/core';
import type { Clock, ErrorCode, Logger } from '@getir/core';
import { acceptRequestId, REQUEST_ID_METADATA_KEY } from '@getir/observability';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';

import type { JoinRoom } from '../../application/join-room.js';
import { createJoinRateLimiter } from '../../application/join-rate-limit.js';
import type { JoinRateLimiter } from '../../application/join-rate-limit.js';
import { JOIN_RATE_LIMIT, MAX_CLIENT_PAYLOAD_BYTES, SOCKET_PATH } from '../../config/constants.js';
import type { AdapterFactory } from '../../infrastructure/redis-adapter.js';
import { INVALID_ROOM_LABEL, JOINED_OUTCOME } from '../metrics.js';
import type { RealtimeMetrics } from '../metrics.js';
import { isAck, joinedBody, rejectedBody } from './ack.js';
import type { Ack } from './ack.js';

/** Span'leri acan kodun adi (iz goruntuleyicide "instrumentation scope"). */
const TRACER_NAME = '@getir/realtime-service';

/** Span adi: olay adi (rota kalibi gibi sabit; oda adi YAZILMAZ). */
const JOIN_SPAN_NAME = `realtime ${SOCKET_EVENTS.ROOM_JOIN}`;

/** Span nitelikleri: proje kurallarindaki izin listesi (yalnizca korelasyon ve hata kodu). */
const SPAN_ATTRIBUTES = {
  REQUEST_ID: 'app.request_id',
  ERROR_CODE: 'app.error_code',
} as const;

export interface SocketServerOptions {
  readonly httpServer: HttpServer;
  /** Verilmezse Socket.io'nun bellek adapter'i (tek kopya; MOCK). */
  readonly adapter?: AdapterFactory;
  readonly joinRoom: JoinRoom;
  readonly logger: Logger;
  readonly metrics: RealtimeMetrics;
  readonly clock: Clock;
}

/** Sunucuyu HTTP sunucusuna baglar; dinlemeyi cagiran baslatir. */
export function createSocketServer(options: SocketServerOptions): Server {
  const io = new Server(options.httpServer, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    // Istemci kutuphanesi web paketinden gelir; sunucu dosya sunmaz.
    serveClient: false,
    maxHttpBufferSize: MAX_CLIENT_PAYLOAD_BYTES,
    ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
  });
  io.on('connection', (socket) => {
    onConnection(socket, options);
  });
  return io;
}

interface Connection {
  readonly socket: Socket;
  readonly requestId: string;
  readonly logger: Logger;
  readonly limiter: JoinRateLimiter;
  readonly options: SocketServerOptions;
}

function onConnection(socket: Socket, options: SocketServerOptions): void {
  const requestId = acceptRequestId(socket.handshake.headers[REQUEST_ID_METADATA_KEY]);
  const connection: Connection = {
    socket,
    requestId,
    logger: options.logger.child({ requestId, socketId: socket.id }),
    limiter: createJoinRateLimiter({
      maxAttempts: JOIN_RATE_LIMIT.MAX_ATTEMPTS,
      windowMs: JOIN_RATE_LIMIT.WINDOW_MS,
      clock: options.clock,
    }),
    options,
  };
  options.metrics.connectionOpened();
  connection.logger.debug({}, 'soket baglandi');

  const onJoin = (...args: unknown[]): void => {
    // Istemci govdesiz ama ack'li gonderebilir: son arguman fonksiyonsa ack'tir.
    const last = args.at(-1);
    const ack = isAck(last) ? last : undefined;
    const payload = ack === undefined ? args[0] : args.length > 1 ? args[0] : undefined;
    void handleJoin(connection, payload, ack);
  };
  socket.on(SOCKET_EVENTS.ROOM_JOIN, onJoin);
  socket.once('disconnect', (reason: string) => {
    socket.off(SOCKET_EVENTS.ROOM_JOIN, onJoin);
    options.metrics.connectionClosed();
    connection.logger.debug({ reason }, 'soket ayrildi');
  });
}

/** room.join'i span icinde isler; hata firlatmaz (cagiran beklemez). */
async function handleJoin(
  connection: Connection,
  payload: unknown,
  ack: Ack | undefined,
): Promise<void> {
  const tracer = trace.getTracer(TRACER_NAME);
  await tracer.startActiveSpan(
    JOIN_SPAN_NAME,
    { kind: SpanKind.SERVER, attributes: { [SPAN_ATTRIBUTES.REQUEST_ID]: connection.requestId } },
    async (span) => {
      try {
        await join(connection, payload, ack, span);
      } catch (error: unknown) {
        connection.logger.error({ err: error }, 'room.join beklenmeyen hata');
        connection.options.metrics.roomJoin(INVALID_ROOM_LABEL, ERROR_CODES.INTERNAL);
        markError(span, ERROR_CODES.INTERNAL, error);
        ack?.(rejectedBody(ERROR_CODES.INTERNAL, connection.requestId));
      } finally {
        span.end();
      }
    },
  );
}

async function join(
  connection: Connection,
  payload: unknown,
  ack: Ack | undefined,
  span: Span,
): Promise<void> {
  const { options, socket, logger, limiter, requestId } = connection;
  const result = await options.joinRoom({ payload, limiter });
  if (result.ok) {
    await socket.join(result.room.name);
    options.metrics.roomJoin(result.room.kind, JOINED_OUTCOME);
    logger.info({ room: result.room.name }, 'odaya katildi');
    ack?.(joinedBody(result.room.name));
    return;
  }
  options.metrics.roomJoin(result.room?.kind ?? INVALID_ROOM_LABEL, result.code);
  // B28: yetkisiz katilim reddedilir VE loglanir. Jeton gunluge yazilmaz.
  logAtSeverity(logger, result.code, {
    rejection: result.rejection,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    ...(result.room === undefined ? {} : { room: result.room.name }),
  });
  markError(span, result.code);
  ack?.(rejectedBody(result.code, requestId));
}

/** Seviye kodun agirligindan (proje kurallari "Seviye sozlesmesi"). */
function logAtSeverity(logger: Logger, code: ErrorCode, fields: Record<string, string>): void {
  const message = 'odaya katilim reddedildi';
  const line = { code, ...fields };
  switch (errorSeverityFor(code)) {
    case ERROR_SEVERITY.EXPECTED:
      logger.info(line, message);
      return;
    case ERROR_SEVERITY.UNUSUAL:
      logger.warn(line, message);
      return;
    case ERROR_SEVERITY.UNEXPECTED:
      logger.error(line, message);
  }
}

/** Beklenen is sonucu span'i hatali isaretlemez; yalnizca kod yazilir (ADR-20). */
function markError(span: Span, code: ErrorCode, error?: unknown): void {
  span.setAttribute(SPAN_ATTRIBUTES.ERROR_CODE, code);
  if (errorSeverityFor(code) === ERROR_SEVERITY.EXPECTED) {
    return;
  }
  span.setStatus({ code: SpanStatusCode.ERROR });
  if (error instanceof Error) {
    span.recordException(error);
  }
}
