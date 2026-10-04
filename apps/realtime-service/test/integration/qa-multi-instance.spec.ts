/**
 * QA kara kutu: birden cok realtime kopyasi, tek Redis (Testcontainers) (T12.1,
 * ADR-06; socket-events.md "Yayin kurallari" ve "Baglanti akisi" 5. adim).
 *
 * Backend'in entegrasyon testi yayinin kopyalar arasinda ULASTIGINI kanitlar;
 * burada ters yon sinanir: siparis odasinin yayini kopya degistirince baska
 * siparisin odasina ya da market odasina SIZMAZ. Ayrica oda uyeligi kopyalar
 * arasinda tasinmaz: kopya duserse istemci yeniden katilmak zorundadir.
 */

import { SOCKET_EVENTS } from '@getir/contracts';
import { silentLogger, systemClock } from '@getir/core';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startRealtimeServer } from '../../src/bootstrap.js';
import type { RealtimeServer } from '../../src/bootstrap.js';
import { openRedisAdapter } from '../../src/infrastructure/redis-adapter.js';
import { collectEvents, connectClient, joinRoom, nextEvent } from '../support/clients.js';
import { orderStatusFor, stockChangedFor } from '../support/qa-harness.js';
import {
  MARKET_ID,
  ORDER_ID,
  ORDER_ROOM,
  OTHER_ORDER_ROOM,
  signRoomToken,
  STORE_ROOM,
  TEST_SECRET,
} from '../support/tokens.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const REDIS_IMAGE = 'redis:7-alpine';

/** Metrik portunun sabit karsiligi (port + 1000): port 0'da bu olmamali. */
const FIXED_METRICS_PORT_FOR_ZERO = 1_000;

describe('QA: iki kopya, tek Redis', () => {
  let container: StartedRedisContainer;
  let redisUrl: string;
  const servers: RealtimeServer[] = [];
  const clients: Socket[] = [];

  async function startNode(): Promise<RealtimeServer> {
    const adapter = await openRedisAdapter({
      redis: { REDIS_URL: redisUrl, REDIS_CONNECT_TIMEOUT_MS: 5_000 },
      logger: silentLogger,
    });
    const server = await startRealtimeServer({
      host: '127.0.0.1',
      port: 0,
      logger: silentLogger,
      tokenSecret: TEST_SECRET,
      adapter,
    });
    servers.push(server);
    return server;
  }

  async function clientOf(server: RealtimeServer): Promise<Socket> {
    const socket = await connectClient(server.port);
    clients.push(socket);
    return socket;
  }

  const tokenFor = (room: string): Promise<string> => signRoomToken(systemClock.now(), { room });

  beforeAll(async () => {
    container = await new RedisContainer(REDIS_IMAGE).start();
    redisUrl = container.getConnectionUrl();
  });

  afterAll(async () => {
    for (const socket of clients) {
      socket.close();
    }
    await Promise.all(servers.map((server) => server.shutdown('qa testi bitti')));
    await container?.stop();
  });

  it('QA-RT-04b: port 0 ile acilan iki kopyanin metrik portu sabit 1000 degil ve birbirinden farkli', async () => {
    const [first, second] = await Promise.all([startNode(), startNode()]);

    expect(first.metricsPort).not.toBe(FIXED_METRICS_PORT_FOR_ZERO);
    expect(second.metricsPort).not.toBe(FIXED_METRICS_PORT_FOR_ZERO);
    expect(first.metricsPort).not.toBe(second.metricsPort);
  });

  it('QA-RT-60: siparis odasinin yayini kopya degistirince yalnizca o odadakine gider', async () => {
    const [one, two] = await Promise.all([startNode(), startNode()]);
    const [ownerOnOne, otherOwnerOnTwo, anonymousOnTwo] = await Promise.all([
      clientOf(one),
      clientOf(two),
      clientOf(two),
    ]);
    await expect(
      joinRoom(ownerOnOne, { room: ORDER_ROOM, token: await tokenFor(ORDER_ROOM) }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      joinRoom(otherOwnerOnTwo, {
        room: OTHER_ORDER_ROOM,
        token: await tokenFor(OTHER_ORDER_ROOM),
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(joinRoom(anonymousOnTwo, { room: STORE_ROOM })).resolves.toMatchObject({
      success: true,
    });

    const received = nextEvent(ownerOnOne, SOCKET_EVENTS.ORDER_STATUS);
    const otherSilence = collectEvents(otherOwnerOnTwo, SOCKET_EVENTS.ORDER_STATUS);
    const anonymousSilence = collectEvents(anonymousOnTwo, SOCKET_EVENTS.ORDER_STATUS);
    expect(two.broadcast(ORDER_ROOM, 'order.status', orderStatusFor(ORDER_ID))).toBe(true);

    await expect(received).resolves.toEqual(orderStatusFor(ORDER_ID));
    await expect(otherSilence).resolves.toEqual([]);
    await expect(anonymousSilence).resolves.toEqual([]);

    // Ters yon: market odasinin yayini siparis odalarina gitmez.
    const ownerSilence = collectEvents(ownerOnOne, SOCKET_EVENTS.STOCK_CHANGED);
    const stock = nextEvent(anonymousOnTwo, SOCKET_EVENTS.STOCK_CHANGED);
    expect(one.broadcast(STORE_ROOM, 'stock.changed', stockChangedFor(MARKET_ID))).toBe(true);
    await expect(stock).resolves.toEqual(stockChangedFor(MARKET_ID));
    await expect(ownerSilence).resolves.toEqual([]);
  });

  it('QA-RT-61: kopya kapaninca istemci digerine baglanir; room.join yapana kadar olay gelmez', async () => {
    const [leaving, staying] = await Promise.all([startNode(), startNode()]);
    const before = await clientOf(leaving);
    await joinRoom(before, { room: ORDER_ROOM, token: await tokenFor(ORDER_ROOM) });

    await leaving.shutdown('kopya dusuyor');
    const after = await clientOf(staying);

    const silence = collectEvents(after, SOCKET_EVENTS.ORDER_STATUS);
    staying.broadcast(ORDER_ROOM, 'order.status', orderStatusFor(ORDER_ID, 2));
    await expect(silence).resolves.toEqual([]);

    await expect(
      joinRoom(after, { room: ORDER_ROOM, token: await tokenFor(ORDER_ROOM) }),
    ).resolves.toMatchObject({ success: true });
    const received = nextEvent(after, SOCKET_EVENTS.ORDER_STATUS);
    staying.broadcast(ORDER_ROOM, 'order.status', orderStatusFor(ORDER_ID, 3));
    await expect(received).resolves.toEqual(orderStatusFor(ORDER_ID, 3));
  });
});
