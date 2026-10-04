/**
 * QA kara kutu testlerinin ortak duzenegi (T12.1 + T12.2): gercek sunucu (port 0,
 * bellek adapter'i), ileri sarilabilen saat, kayit tutan gunluk ve her alani
 * serbestce kurulabilen jetonlar.
 *
 * Backend'in support/tokens.ts'i gateway bicimindeki jetonu ve tek alanlik
 * bozulmalari uretir; buradaki `signClaims` ise govdeyi ve imzayi TAMAMEN disaridan
 * alir (erisim jetonu bicimi, RS256, eksik exp gibi tokens.ts'in kuramadigi jetonlar).
 */

import { ERROR_MESSAGES, SOCKET_EVENTS } from '@getir/contracts';
import { fixedClock } from '@getir/core';
import type { MutableClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { SignJWT } from 'jose';
import type { CryptoKey, JWTPayload, KeyObject } from 'jose';
import type { Socket } from 'socket.io-client';
import { expect } from 'vitest';

import { startRealtimeServer } from '../../src/bootstrap.js';
import type { RealtimeServer } from '../../src/bootstrap.js';
import { collectEvents, connectClient, joinRoom, nextEvent } from './clients.js';
import type { ConnectOptions } from './clients.js';
import { signRoomToken, TEST_SECRET } from './tokens.js';

/** Testlerin sabit "simdi"si; saat yalnizca testin ileri sarmasiyla ilerler. */
export const QA_NOW_MS = Date.UTC(2026, 9, 3, 12, 0, 0);
export const QA_NOW_SECONDS = Math.floor(QA_NOW_MS / 1000);

const AT = '2026-10-03T12:00:00.000Z';

/** Korelasyon kimligi bicimi (gateway kurali, #22). */
export const REQUEST_ID_PATTERN = /^req_[0-9a-f]{32}$/;

export interface QaServer {
  readonly server: RealtimeServer;
  readonly clock: MutableClock;
  readonly lines: LogLine[];
  /** Yalnizca websocket ile baglanan, testin sonunda kapatilan istemci. */
  client(options?: ConnectOptions): Promise<Socket>;
  /** Istemcileri ve sunucuyu kapatir. */
  close(): Promise<void>;
}

export interface QaServerOptions {
  /** true: sirsiz kopya (yalnizca MOCK, D3): siparis odalari kapali. */
  readonly withoutSecret?: boolean;
}

export async function startQaServer(options: QaServerOptions = {}): Promise<QaServer> {
  const clock = fixedClock(QA_NOW_MS);
  const lines: LogLine[] = [];
  const server = await startRealtimeServer({
    host: '127.0.0.1',
    port: 0,
    logger: recordingLogger(lines),
    tokenSecret: options.withoutSecret === true ? undefined : TEST_SECRET,
    clock,
  });
  const sockets: Socket[] = [];
  return {
    server,
    clock,
    lines,
    client: async (connectOptions = {}) => {
      const socket = await connectClient(server.port, connectOptions);
      sockets.push(socket);
      return socket;
    },
    close: async () => {
      for (const socket of sockets) {
        socket.close();
      }
      await server.shutdown('qa testi bitti');
    },
  };
}

/** Siparis odasinin gecerli bir order.status olayi (yayin kapisindan gecer). */
export function orderStatusFor(orderId: string, seq = 1) {
  return { orderId, status: 'PAID', at: AT, seq };
}

/** Market odasinin gecerli bir stock.changed olayi. */
export function stockChangedFor(marketId: string) {
  return { marketId, productId: 'prd_sut-1l', availableQuantity: 3, at: AT };
}

/**
 * Reddedilen soketin odaya ALINMADIGININ kaniti: odaya yayin yapilir, soket
 * SILENCE_MS boyunca hicbir sey almamalidir. Ayni yayini odaya gecerli jetonla
 * giren bir TANIK alir: sessizlik "yayin hic calismadi" yuzunden gecemez.
 */
export async function expectNotInOrderRoom(
  qa: QaServer,
  socket: Socket,
  orderId: string,
): Promise<void> {
  const room = `order:${orderId}`;
  const witness = await qa.client();
  await expect(
    joinRoom(witness, { room, token: await signRoomToken(qa.clock.now(), { room }) }),
  ).resolves.toMatchObject({ success: true });

  const delivered = nextEvent(witness, SOCKET_EVENTS.ORDER_STATUS);
  const silence = collectEvents(socket, SOCKET_EVENTS.ORDER_STATUS);
  expect(qa.server.broadcast(room, 'order.status', orderStatusFor(orderId))).toBe(true);

  await expect(delivered).resolves.toEqual(orderStatusFor(orderId));
  await expect(silence).resolves.toEqual([]);
}

/** Hata ack'inin beklenen bicimi (socket-events.md "Ack zarfi"). */
export function failure(code: keyof typeof ERROR_MESSAGES) {
  // Eslesici `any` doner; `unknown`a baglanir (no-unsafe-assignment).
  const requestId: unknown = expect.stringMatching(REQUEST_ID_PATTERN);
  return { success: false, error: { code, message: ERROR_MESSAGES[code], requestId } };
}

export interface ClaimsToken {
  readonly claims: JWTPayload;
  /** Korunan baslik: `alg` zorunlu. */
  readonly header?: { readonly alg: string; readonly typ?: string };
  /** HS* icin metin sir; RS256 gibi asimetrik algoritmada ozel anahtar. */
  readonly key?: string | CryptoKey | KeyObject;
}

/** Govdesi ve imzasi tamamen disaridan gelen jeton (varsayilan HS256, test sirri). */
export function signClaims({ claims, header, key }: ClaimsToken): Promise<string> {
  const signingKey =
    typeof key === 'string' || key === undefined
      ? new TextEncoder().encode(key ?? TEST_SECRET)
      : key;
  return new SignJWT(claims).setProtectedHeader(header ?? { alg: 'HS256' }).sign(signingKey);
}
