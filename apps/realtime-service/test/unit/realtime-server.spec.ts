/**
 * Gercek sunucu (port 0, bellek adapter'i) + gercek socket.io-client: room.join'in
 * tel uzerindeki davranisi, ack zarfi, yayin, sinir, korelasyon kimligi, metrik,
 * iz ve kapanis. Kopyalar arasi yayin (Redis) entegrasyon testindedir.
 */

import { ERROR_MESSAGES, SOCKET_EVENTS } from '@getir/contracts';
import { fixedClock } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { metricsRegistry } from '@getir/observability';
import { metricValue, recordSpans, SpanStatusCode } from '@getir/observability/testing';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startRealtimeServer } from '../../src/bootstrap.js';
import type { RealtimeServer } from '../../src/bootstrap.js';
import { JOIN_RATE_LIMIT, MAX_CLIENT_PAYLOAD_BYTES } from '../../src/config/constants.js';
import { METRIC_NAMES } from '../../src/interfaces/metrics.js';
import {
  collectEvents,
  connectClient,
  disconnection,
  joinRoom,
  nextEvent,
} from '../support/clients.js';
import {
  MARKET_ID,
  ORDER_ID,
  ORDER_ROOM,
  OTHER_ORDER_ROOM,
  OTHER_SECRET,
  signRoomToken,
  STORE_ROOM,
  TEST_SECRET,
} from '../support/tokens.js';

// Saglayici, sunucu startTracing'i cagirmadan ONCE kurulmali.
const spans = recordSpans();

const NOW_MS = Date.UTC(2026, 9, 3, 12, 0, 0);
const AT = '2026-10-03T12:00:00.000Z';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';

const orderStatus = { orderId: ORDER_ID, status: 'PAID', at: AT, seq: 1 };
const stockChanged = { marketId: MARKET_ID, productId: 'prd_sut-1l', availableQuantity: 3, at: AT };

let server: RealtimeServer | undefined;
let clients: Socket[] = [];
let lines: LogLine[] = [];

/** `withoutSecret`: sirsiz kopya (yalnizca MOCK, D3). */
async function start(withoutSecret = false): Promise<RealtimeServer> {
  server = await startRealtimeServer({
    host: '127.0.0.1',
    port: 0,
    logger: recordingLogger(lines),
    tokenSecret: withoutSecret ? undefined : TEST_SECRET,
    clock: fixedClock(NOW_MS),
  });
  return server;
}

async function client(options: Parameters<typeof connectClient>[1] = {}): Promise<Socket> {
  if (server === undefined) {
    throw new Error('once start()');
  }
  const socket = await connectClient(server.port, options);
  clients.push(socket);
  return socket;
}

const token = (overrides: Parameters<typeof signRoomToken>[1] = {}): Promise<string> =>
  signRoomToken(NOW_MS, overrides);

function failure(
  code: keyof typeof ERROR_MESSAGES,
  requestId: unknown = expect.stringMatching(/^req_[0-9a-f]{32}$/),
) {
  return { success: false, error: { code, message: ERROR_MESSAGES[code], requestId } };
}

beforeEach(() => {
  metricsRegistry.resetMetrics();
  spans.reset();
  lines = [];
});

afterEach(async () => {
  for (const socket of clients) {
    socket.close();
  }
  clients = [];
  await server?.shutdown('test bitti');
  server = undefined;
});

describe('room.join', () => {
  it('iki istemci ayni market odasinda olayi alir; baska odadaki almaz (T12.1)', async () => {
    const realtime = await start();
    const [first, second, outsider] = await Promise.all([client(), client(), client()]);
    await expect(joinRoom(first, { room: STORE_ROOM })).resolves.toEqual({
      success: true,
      data: { room: STORE_ROOM },
    });
    await joinRoom(second, { room: STORE_ROOM });
    await joinRoom(outsider, { room: 'store:mkt_baska-market' });

    const received = Promise.all([
      nextEvent(first, 'stock.changed'),
      nextEvent(second, 'stock.changed'),
    ]);
    const silence = collectEvents(outsider, 'stock.changed');
    expect(realtime.broadcast(STORE_ROOM, 'stock.changed', stockChanged)).toBe(true);

    await expect(received).resolves.toEqual([stockChanged, stockChanged]);
    await expect(silence).resolves.toEqual([]);
  });

  it('siparis odasina kendi jetonuyla girer ve olayi alir', async () => {
    const realtime = await start();
    const owner = await client();

    await expect(joinRoom(owner, { room: ORDER_ROOM, token: await token() })).resolves.toEqual({
      success: true,
      data: { room: ORDER_ROOM },
    });
    const received = nextEvent(owner, 'order.status');
    realtime.broadcast(ORDER_ROOM, 'order.status', orderStatus);

    await expect(received).resolves.toEqual(orderStatus);
  });

  it.each([
    ['jetonsuz', () => Promise.resolve({ room: ORDER_ROOM }), 'FORBIDDEN'],
    ['bos jetonla (QA 20)', () => Promise.resolve({ room: ORDER_ROOM, token: '' }), 'FORBIDDEN'],
    [
      'baska siparisin jetonuyla',
      async () => ({ room: ORDER_ROOM, token: await token({ room: OTHER_ORDER_ROOM }) }),
      'UNAUTHORIZED',
    ],
    [
      'erisim jetonuyla (baska sir, alicisiz)',
      async () => ({
        room: ORDER_ROOM,
        token: await token({ secret: OTHER_SECRET, audience: null }),
      }),
      'UNAUTHORIZED',
    ],
    [
      'suresi dolmus jetonla',
      async () => ({
        room: ORDER_ROOM,
        token: await token({ issuedAt: Math.floor(NOW_MS / 1000) - 120 }),
      }),
      'UNAUTHORIZED',
    ],
    [
      'metin olmayan jetonla (QA 20)',
      () => Promise.resolve({ room: ORDER_ROOM, token: 42 }),
      'VALIDATION_FAILED',
    ],
    ['bicim disi oda adiyla', () => Promise.resolve({ room: 'order:' }), 'VALIDATION_FAILED'],
  ] as const)(
    'siparis odasina %s girilmez, odanin olayi gelmez (T12.2)',
    async (_name, payload, code) => {
      const realtime = await start();
      const intruder = await client();

      await expect(joinRoom(intruder, await payload())).resolves.toEqual(failure(code));
      const silence = collectEvents(intruder, 'order.status');
      realtime.broadcast(ORDER_ROOM, 'order.status', orderStatus);

      await expect(silence).resolves.toEqual([]);
    },
  );

  it('market odasina gelen jeton yok sayilir (QA 06)', async () => {
    await start();
    const socket = await client();

    await expect(joinRoom(socket, { room: STORE_ROOM, token: 'bozuk-jeton' })).resolves.toEqual({
      success: true,
      data: { room: STORE_ROOM },
    });
  });

  it('ayni odaya ikinci katilim da basarilidir, olay bir kez gelir (QA 37)', async () => {
    const realtime = await start();
    const socket = await client();
    await joinRoom(socket, { room: STORE_ROOM });

    await expect(joinRoom(socket, { room: STORE_ROOM })).resolves.toMatchObject({ success: true });
    const events = collectEvents(socket, 'stock.changed');
    realtime.broadcast(STORE_ROOM, 'stock.changed', stockChanged);

    await expect(events).resolves.toEqual([stockChanged]);
  });

  it('ack vermeyen istemci de odaya katilir', async () => {
    const realtime = await start();
    const socket = await client();

    socket.emit(SOCKET_EVENTS.ROOM_JOIN, { room: STORE_ROOM });
    // Ack yok: katilimi ikinci (ack'li) bir istekle siralariz.
    await joinRoom(socket, { room: 'store:mkt_baska-market' });
    const received = nextEvent(socket, 'stock.changed');
    realtime.broadcast(STORE_ROOM, 'stock.changed', stockChanged);

    await expect(received).resolves.toEqual(stockChanged);
  });

  it('sirsiz kopyada siparis odasi SERVICE_UNAVAILABLE, market odasi acik (D3)', async () => {
    await start(true);
    const socket = await client();

    await expect(joinRoom(socket, { room: ORDER_ROOM, token: await token() })).resolves.toEqual(
      failure('SERVICE_UNAVAILABLE'),
    );
    await expect(joinRoom(socket, { room: STORE_ROOM })).resolves.toMatchObject({ success: true });
  });
});

describe('sinir (D8)', () => {
  it('soket basina pencerede 10 deneme; 11. deneme bozuk adla da RATE_LIMITED (QA 54)', async () => {
    await start();
    const socket = await client();
    for (let attempt = 0; attempt < JOIN_RATE_LIMIT.MAX_ATTEMPTS; attempt += 1) {
      await joinRoom(socket, { room: STORE_ROOM });
    }

    await expect(joinRoom(socket, { room: 'bozuk' })).resolves.toEqual(failure('RATE_LIMITED'));
    await expect(joinRoom(socket, { room: STORE_ROOM })).resolves.toEqual(failure('RATE_LIMITED'));
  });

  it('yeniden baglanan istemcinin sayaci sifirdir (QA 52)', async () => {
    await start();
    const first = await client();
    for (let attempt = 0; attempt <= JOIN_RATE_LIMIT.MAX_ATTEMPTS; attempt += 1) {
      await joinRoom(first, { room: STORE_ROOM });
    }
    first.close();

    const again = await client();

    await expect(joinRoom(again, { room: STORE_ROOM })).resolves.toMatchObject({ success: true });
  });
});

describe('baglanti', () => {
  it('bicimli x-request-id ack hatasinda ve gunlukte kullanilir (#22)', async () => {
    await start();
    const socket = await client({ headers: { 'x-request-id': REQUEST_ID } });

    await expect(joinRoom(socket, { room: ORDER_ROOM })).resolves.toEqual(
      failure('FORBIDDEN', REQUEST_ID),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'odaya katilim reddedildi',
        fields: expect.objectContaining({
          requestId: REQUEST_ID,
          code: 'FORBIDDEN',
          rejection: 'token_missing',
        }) as unknown,
      }),
    );
  });

  it('bicim disi x-request-id kabul edilmez, yenisi uretilir (#22)', async () => {
    await start();
    const socket = await client({ headers: { 'x-request-id': 'istemcinin-uydurdugu' } });

    const ack = await joinRoom(socket, { room: ORDER_ROOM });

    expect(ack).toEqual(failure('FORBIDDEN'));
    expect(JSON.stringify(lines)).not.toContain('istemcinin-uydurdugu');
  });

  it('jeton gunluge yazilmaz', async () => {
    await start();
    const socket = await client();
    const secret = await token({ room: OTHER_ORDER_ROOM });

    await joinRoom(socket, { room: ORDER_ROOM, token: secret });

    expect(JSON.stringify(lines)).not.toContain(secret);
  });

  it('HTTP yoklamasi (polling) kabul edilmez: yalnizca websocket (D2)', async () => {
    await start();

    await expect(client({ transports: ['polling'] })).rejects.toThrow();
  });

  it('siniri asan paket baglantiyi keser', async () => {
    await start();
    const socket = await client();
    const closed = disconnection(socket);

    socket.emit(SOCKET_EVENTS.ROOM_JOIN, {
      room: ORDER_ROOM,
      token: 'x'.repeat(MAX_CLIENT_PAYLOAD_BYTES),
    });

    await expect(closed).resolves.toBe('transport close');
  });
});

describe('gozlem', () => {
  it('katilimlari oda turu ve sonucla, acik soketleri gostergeyle sayar', async () => {
    await start();
    const socket = await client();
    await joinRoom(socket, { room: STORE_ROOM });
    await joinRoom(socket, { room: ORDER_ROOM });
    await joinRoom(socket, { room: 'order:' });

    expect(await metricValue(METRIC_NAMES.ROOM_JOINS, { room: 'store', outcome: 'joined' })).toBe(
      1,
    );
    expect(
      await metricValue(METRIC_NAMES.ROOM_JOINS, { room: 'order', outcome: 'FORBIDDEN' }),
    ).toBe(1);
    expect(
      await metricValue(METRIC_NAMES.ROOM_JOINS, { room: 'invalid', outcome: 'VALIDATION_FAILED' }),
    ).toBe(1);
    expect(await metricValue(METRIC_NAMES.CONNECTIONS)).toBe(1);

    const closed = disconnection(socket);
    socket.close();
    await closed;
    await expect.poll(() => metricValue(METRIC_NAMES.CONNECTIONS)).toBe(0);
  });

  it('her room.join bir span; beklenen red hata isaretlemez, kodu yazar', async () => {
    await start();
    const socket = await client({ headers: { 'x-request-id': REQUEST_ID } });
    await joinRoom(socket, { room: STORE_ROOM });
    await joinRoom(socket, { room: ORDER_ROOM });

    const joins = spans.finished().filter((span) => span.name === 'realtime room.join');
    expect(joins).toHaveLength(2);
    expect(joins.map((span) => span.attributes)).toEqual([
      { 'app.request_id': REQUEST_ID },
      { 'app.request_id': REQUEST_ID, 'app.error_code': 'FORBIDDEN' },
    ]);
    expect(joins.map((span) => span.status.code)).toEqual([
      SpanStatusCode.UNSET,
      SpanStatusCode.UNSET,
    ]);
  });
});

describe('kapanis', () => {
  it('soketleri koparir (istemci yeniden baglanir), ikinci cagri ayni sozu doner', async () => {
    const realtime = await start();
    const socket = await client();
    const closed = disconnection(socket);

    const first = realtime.shutdown('SIGTERM');
    const second = realtime.shutdown('SIGTERM');
    await first;

    expect(second).toBe(first);
    // "transport close": istemci kendiliginden yeniden baglanir (baska kopyaya).
    // "io server disconnect" olsaydi Socket.io istemcisi yeniden DENEMEZDI.
    await expect(closed).resolves.toBe('transport close');
    expect(lines).toContainEqual(expect.objectContaining({ message: 'realtime kapandi' }));
  });

  it('olay dinleme ONCE durur: o anda soketler ve port hala acik (D9, T12.3)', async () => {
    let seenAtStop: { connected: boolean; health: number } | undefined;
    const tab: { socket?: Socket } = {};
    const realtime = await startRealtimeServer({
      host: '127.0.0.1',
      port: 0,
      logger: recordingLogger(lines),
      tokenSecret: TEST_SECRET,
      clock: fixedClock(NOW_MS),
      events: () =>
        Promise.resolve({
          stop: async () => {
            const health = await fetch(`http://127.0.0.1:${realtime.port}/healthz`);
            seenAtStop = { connected: tab.socket?.connected ?? false, health: health.status };
          },
        }),
    });
    server = realtime;
    tab.socket = await client();

    await realtime.shutdown('SIGTERM');

    // Dinleme durdurulurken Socket.io kapanmamisti: eldeki olaylar hala yayinlanabilir.
    expect(seenAtStop).toEqual({ connected: true, health: 503 });
  });

  it('olay dinleme baslatilamazsa acilis hata verir ve port kapanir', async () => {
    await expect(
      startRealtimeServer({
        host: '127.0.0.1',
        port: 0,
        logger: recordingLogger(lines),
        tokenSecret: TEST_SECRET,
        events: () => Promise.reject(new Error('redis yok')),
      }),
    ).rejects.toThrow('redis yok');
  });
});
