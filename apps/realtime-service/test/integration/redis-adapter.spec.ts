/**
 * Kopyalar arasi yayin (T12.1, K3): gercek Redis (Testcontainers) uzerinde uc
 * realtime kopyasi. A ve B'ye istemciler baglanir; C'de istemci yoktur ve yalnizca
 * yayin yapar (T12.3'teki olay tuketicisinin yapacagi is). Redis adapter calismasa
 * A ve B, C'nin yayinini hic gormezdi.
 *
 * Ayrica ioredis 6 ile @socket.io/redis-adapter 8.3.0 uyumunun kanitidir
 * (adapter psubscribe + pmessageBuffer kullanir).
 */

import { silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startRealtimeServer } from '../../src/bootstrap.js';
import type { RealtimeServer } from '../../src/bootstrap.js';
import { openRedisAdapter } from '../../src/infrastructure/redis-adapter.js';
import type { RedisAdapterHandle } from '../../src/infrastructure/redis-adapter.js';
import { collectEvents, connectClient, joinRoom, nextEvent } from '../support/clients.js';
import {
  MARKET_ID,
  ORDER_ID,
  ORDER_ROOM,
  signRoomToken,
  STORE_ROOM,
  TEST_SECRET,
} from '../support/tokens.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const REDIS_IMAGE = 'redis:7-alpine';

const AT = '2026-10-03T12:00:00.000Z';
const stockChanged = { marketId: MARKET_ID, productId: 'prd_sut-1l', availableQuantity: 2, at: AT };
const orderStatus = {
  orderId: ORDER_ID,
  status: 'PREPARING',
  previousStatus: 'PAID',
  at: AT,
  seq: 2,
};

interface Node {
  readonly server: RealtimeServer;
  readonly adapter: RedisAdapterHandle;
}

async function startNode(url: string, logger: Logger = silentLogger): Promise<Node> {
  const adapter = await openRedisAdapter({
    redis: { REDIS_URL: url, REDIS_CONNECT_TIMEOUT_MS: 5_000 },
    logger,
  });
  const server = await startRealtimeServer({
    host: '127.0.0.1',
    port: 0,
    logger: silentLogger,
    tokenSecret: TEST_SECRET,
    adapter,
  });
  return { server, adapter };
}

describe('Redis adapter: uc kopya, tek oda', () => {
  let container: StartedRedisContainer;
  let nodes: Node[] = [];
  const clients: Socket[] = [];

  const node = (index: number): Node => {
    const found = nodes[index];
    if (found === undefined) {
      throw new Error(`kopya ${index} yok`);
    }
    return found;
  };

  async function clientOf(index: number): Promise<Socket> {
    const socket = await connectClient(node(index).server.port);
    clients.push(socket);
    return socket;
  }

  beforeAll(async () => {
    container = await new RedisContainer(REDIS_IMAGE).start();
    const url = container.getConnectionUrl();
    nodes = await Promise.all([startNode(url), startNode(url), startNode(url)]);
  });

  afterAll(async () => {
    for (const socket of clients) {
      socket.close();
    }
    await Promise.all(nodes.map(({ server }) => server.shutdown('test bitti')));
    await container?.stop();
  });

  it('A ve B kopyalarindaki iki istemci, C kopyasinin yayinini alir; baska odadaki almaz', async () => {
    const [onA, onB, outsider] = await Promise.all([clientOf(0), clientOf(1), clientOf(1)]);
    await joinRoom(onA, { room: STORE_ROOM });
    await joinRoom(onB, { room: STORE_ROOM });
    await joinRoom(outsider, { room: 'store:mkt_baska-market' });

    const received = Promise.all([
      nextEvent(onA, 'stock.changed'),
      nextEvent(onB, 'stock.changed'),
    ]);
    const silence = collectEvents(outsider, 'stock.changed');
    expect(node(2).server.broadcast(STORE_ROOM, 'stock.changed', stockChanged)).toBe(true);

    await expect(received).resolves.toEqual([stockChanged, stockChanged]);
    await expect(silence).resolves.toEqual([]);
  });

  it('siparis odasi: jetonla giren iki sekme (A, B) olayi alir, jetonsuz deneyen almaz', async () => {
    const token = await signRoomToken(Date.now());
    const [tabOnA, tabOnB, intruder] = await Promise.all([clientOf(0), clientOf(1), clientOf(0)]);
    // Ayni jeton iki sokette (iki sekme) kullanilabilir: jti yok (QA 23).
    await expect(joinRoom(tabOnA, { room: ORDER_ROOM, token })).resolves.toMatchObject({
      success: true,
    });
    await expect(joinRoom(tabOnB, { room: ORDER_ROOM, token })).resolves.toMatchObject({
      success: true,
    });
    await expect(joinRoom(intruder, { room: ORDER_ROOM })).resolves.toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });

    const received = Promise.all([
      nextEvent(tabOnA, 'order.status'),
      nextEvent(tabOnB, 'order.status'),
    ]);
    const silence = collectEvents(intruder, 'order.status');
    node(2).server.broadcast(ORDER_ROOM, 'order.status', orderStatus);

    await expect(received).resolves.toEqual([orderStatus, orderStatus]);
    await expect(silence).resolves.toEqual([]);
  });

  it('kopyalar Redis hazirken saglikli', async () => {
    for (const { server, adapter } of nodes) {
      expect(adapter.isReady()).toBe(true);
      const response = await fetch(`http://127.0.0.1:${server.port}/healthz`);
      expect(response.status).toBe(200);
    }
  });
});

describe('Redis adapter: Redis giderse', () => {
  it('saglik ucu 503 doner (QA 03b); yayin ve kapanis sureci DUSURMEZ, uyari yazilir', async () => {
    // Vitest yakalanmamis bir red gorurse kosuyu kirmizi yapar: bu test ayni
    // zamanda adapter'in beklemedigi komutlarin (publish, unsubscribe) reddinin
    // yakalandiginin kanitidir (redis-adapter.ts dosya basi).
    const lines: LogLine[] = [];
    const container = await new RedisContainer(REDIS_IMAGE).start();
    const { server, adapter } = await startNode(
      container.getConnectionUrl(),
      recordingLogger(lines),
    );
    expect((await fetch(`http://127.0.0.1:${server.port}/healthz`)).status).toBe(200);

    await container.stop();

    await expect
      .poll(async () => (await fetch(`http://127.0.0.1:${server.port}/healthz`)).status, {
        timeout: 10_000,
      })
      .toBe(503);
    expect(adapter.isReady()).toBe(false);

    expect(server.broadcast(STORE_ROOM, 'stock.changed', stockChanged)).toBe(true);
    // Red, ioredis'in deneme hakki (3 yeniden baglanma) bitince gelir; kapali portta
    // her deneme baglanti suresine (5 sn) kadar surebilir.
    await expect
      .poll(
        () => lines.filter((line) => line.message === 'redis adapter komutu basarisiz').length,
        { timeout: 30_000, interval: 250 },
      )
      .toBeGreaterThan(0);
    expect(lines.find((line) => line.message === 'redis adapter komutu basarisiz')).toMatchObject({
      level: 'warn',
      fields: { command: 'publish', connection: 'realtime-pub' },
    });

    await server.shutdown('test bitti');
  }, 90_000);
});
