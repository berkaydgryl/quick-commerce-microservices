/**
 * QA kara kutu: room.join ack'inin zarfi (socket-events.md "Ack zarfi"). Ack,
 * REST ile ayni zarftir: web onu contracts semalariyla ayristirir. Burada her
 * ulasilabilen hata kodu ve basari, sozlesmenin KENDI semasindan gecirilir;
 * elle yazilmis beklenen nesneyle karsilastirma yetmez (fazla alan gozden kacar).
 */

import {
  apiErrorResponseSchema,
  apiResponseSchema,
  ERROR_MESSAGES,
  roomJoinResultSchema,
} from '@getir/contracts';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { joinRoom } from '../support/clients.js';
import { QA_NOW_MS, REQUEST_ID_PATTERN, startQaServer } from '../support/qa-harness.js';
import type { QaServer } from '../support/qa-harness.js';
import { JOIN_RATE_LIMIT } from '../../src/config/constants.js';
import { ORDER_ROOM, OTHER_ORDER_ROOM, signRoomToken, STORE_ROOM } from '../support/tokens.js';

const roomJoinAckSchema = apiResponseSchema(roomJoinResultSchema);

let qa: QaServer | undefined;

afterEach(async () => {
  await qa?.close();
  qa = undefined;
});

/** Ack'i sozlesmeden gecirir ve hata kolunu doner; basariysa test duser. */
function parseFailure(ack: unknown) {
  const parsed = apiErrorResponseSchema.strict().safeParse(ack);
  expect(parsed.success, JSON.stringify(ack)).toBe(true);
  if (!parsed.success) {
    throw new Error('hata zarfi bekleniyordu');
  }
  return parsed.data.error;
}

/** Bir hata kodunu ureten deneme; ayni sokette sirayla calisir. */
type Attempt = (socket: Socket) => Promise<unknown>;

const ATTEMPTS: ReadonlyArray<readonly [string, Attempt]> = [
  ['VALIDATION_FAILED', (socket) => joinRoom(socket, { room: 'admin:x' })],
  ['FORBIDDEN', (socket) => joinRoom(socket, { room: ORDER_ROOM })],
  [
    'UNAUTHORIZED',
    async (socket) =>
      joinRoom(socket, {
        room: ORDER_ROOM,
        token: await signRoomToken(QA_NOW_MS, { room: OTHER_ORDER_ROOM }),
      }),
  ],
];

describe('hata ack zarfi (QA-RT-40)', () => {
  it.each(ATTEMPTS)(
    '%s: sozlesme semasindan (strict) gecer; mesaj sozlukten, requestId bicimli',
    async (code, attempt) => {
      qa = await startQaServer();
      const socket = await qa.client();

      const error = parseFailure(await attempt(socket));

      expect(error.code).toBe(code);
      expect(error.message).toBe(ERROR_MESSAGES[error.code]);
      expect(error.requestId).toMatch(REQUEST_ID_PATTERN);
      // Reddin ic gerekcesi (jeton neden gecersiz) istemciye gitmez.
      expect(Object.keys(error).sort()).toEqual(['code', 'message', 'requestId']);
    },
  );

  it('RATE_LIMITED: ayni zarf ve sozlukteki mesaj', async () => {
    qa = await startQaServer();
    const socket = await qa.client();
    for (let attempt = 0; attempt < JOIN_RATE_LIMIT.MAX_ATTEMPTS; attempt += 1) {
      await joinRoom(socket, { room: STORE_ROOM });
    }

    const error = parseFailure(await joinRoom(socket, { room: STORE_ROOM }));

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toBe(ERROR_MESSAGES.RATE_LIMITED);
    expect(Object.keys(error).sort()).toEqual(['code', 'message', 'requestId']);
  });

  it('SERVICE_UNAVAILABLE: sirsiz kopyada jetonlu siparis odasi; ayni zarf', async () => {
    qa = await startQaServer({ withoutSecret: true });
    const socket = await qa.client();

    const error = parseFailure(
      await joinRoom(socket, { room: ORDER_ROOM, token: await signRoomToken(QA_NOW_MS) }),
    );

    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.message).toBe(ERROR_MESSAGES.SERVICE_UNAVAILABLE);
  });

  it('requestId baglantinin kimligidir: bir baglantida hep ayni, iki baglantida farkli', async () => {
    qa = await startQaServer();
    const [first, second] = await Promise.all([qa.client(), qa.client()]);

    const fromFirst: string[] = [];
    for (const [, attempt] of ATTEMPTS) {
      fromFirst.push(parseFailure(await attempt(first)).requestId);
    }
    const fromSecond = parseFailure(await joinRoom(second, { room: 'admin:x' })).requestId;

    expect(new Set(fromFirst).size).toBe(1);
    expect(fromSecond).not.toBe(fromFirst[0]);
  });
});

describe('basari ack zarfi (QA-RT-41)', () => {
  it.each([
    ['market odasi', () => Promise.resolve({ room: STORE_ROOM })],
    ['siparis odasi', async () => ({ room: ORDER_ROOM, token: await signRoomToken(QA_NOW_MS) })],
  ])('%s: sozlesme semasindan gecer, data.room istenen oda', async (_name, payload) => {
    qa = await startQaServer();
    const socket = await qa.client();
    const request = await payload();

    const parsed = roomJoinAckSchema.safeParse(await joinRoom(socket, request));

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ success: true, data: { room: request.room } });
  });
});
