/**
 * T12.3 gercek Redis'te (Testcontainers): surum deposu (MULTI + ZADD GT) ve
 * uctan uca olay hatti: RedisStreamsPublisher -> stream:events -> "realtime"
 * grubundaki iki kopya -> Redis adapter -> iki kopyadaki istemciler.
 */

import { silentLogger, ID_PREFIX, newId } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { RedisStreamsPublisher, toStreamFields } from '@getir/event-bus';
import type { EventEnvelope } from '@getir/event-bus';
import { connectRedis, EVENTS_STREAM_KEY, realtimeSeqKey } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startRealtimeServer } from '../../src/bootstrap.js';
import type { RealtimeServer } from '../../src/bootstrap.js';
import { SEQ_TTL_MS } from '../../src/config/constants.js';
import { startEventConsuming } from '../../src/events.js';
import { openRedisAdapter } from '../../src/infrastructure/redis-adapter.js';
import { createRedisSeqStore } from '../../src/infrastructure/redis-seq-store.js';
import { collectEvents, connectClient, joinRoom, SILENCE_MS } from '../support/clients.js';
import { ORDER_ID, ORDER_ROOM, signRoomToken, TEST_SECRET, USER_ID } from '../support/tokens.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
const REDIS_IMAGE = 'redis:7-alpine';

/** Testte kisa bekleme: yeni kayit gelince XREADGROUP zaten hemen doner. */
const DELIVERY = { blockMs: 200, claimIdleMs: 1_000, retryDelayMs: 100 };

const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';

function statusEnvelope(version: number, to: string, from?: string): EventEnvelope {
  return {
    eventId: newId(ID_PREFIX.EVENT),
    topic: 'order.status_changed',
    partitionKey: ORDER_ID,
    occurredAt: new Date().toISOString(),
    requestId: REQUEST_ID,
    payload: {
      orderId: ORDER_ID,
      userId: USER_ID,
      marketId: 'mkt_migros-jet-moda',
      ...(from === undefined ? {} : { from }),
      to,
      version,
    },
  };
}

interface Node {
  readonly server: RealtimeServer;
}

async function startNode(url: string, name: string, logger = silentLogger): Promise<Node> {
  const redis = { REDIS_URL: url, REDIS_CONNECT_TIMEOUT_MS: 5_000 };
  const adapter = await openRedisAdapter({ redis, logger });
  const server = await startRealtimeServer({
    host: '127.0.0.1',
    port: 0,
    logger,
    tokenSecret: TEST_SECRET,
    adapter,
    events: (broadcast) =>
      startEventConsuming(
        { redis, adapter, consumerName: name, logger, delivery: DELIVERY },
        broadcast,
      ),
  });
  return { server };
}

/** Odadaki istemcinin aldigi order.status olaylarinin seq'leri, varis aniyla. */
function seqsOf(received: unknown[]): number[] {
  return received.map((payload) => (payload as { seq: number }).seq);
}

describe('surum deposu (gercek Redis)', () => {
  let container: StartedRedisContainer;
  let connection: RedisConnection;

  beforeAll(async () => {
    container = await new RedisContainer(REDIS_IMAGE).start();
    connection = await connectRedis({ url: container.getConnectionUrl() });
  });

  afterAll(async () => {
    await connection?.close();
    await container?.stop();
  });

  it('yalnizca buyuk surumu yazar, onceki degeri doner, omru her yazimda yeniler', async () => {
    const store = createRedisSeqStore({ redis: connection.redis, ttlMs: SEQ_TTL_MS });
    const order = newId(ID_PREFIX.ORDER);

    expect(await store.recordIfNewer(order, 3)).toBeUndefined();
    expect(await store.recordIfNewer(order, 5)).toBe(3);
    expect(await store.recordIfNewer(order, 4)).toBe(5);
    expect(await store.recordIfNewer(order, 5)).toBe(5);

    const key = realtimeSeqKey(order);
    expect(await connection.redis.zscore(key, 'seq')).toBe('5');
    const ttl = await connection.redis.pttl(key);
    expect(ttl).toBeGreaterThan(SEQ_TTL_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(SEQ_TTL_MS);
  });

  it('esz amanli yazimda kayit en buyuk surumde kalir; her surumu tek yazim "yeni" gorur', async () => {
    const store = createRedisSeqStore({ redis: connection.redis, ttlMs: SEQ_TTL_MS });
    const order = newId(ID_PREFIX.ORDER);
    const versions = [7, 3, 9, 1, 9, 4, 8, 2, 6, 5];

    const previous = await Promise.all(
      versions.map((version) => store.recordIfNewer(order, version)),
    );

    expect(await connection.redis.zscore(realtimeSeqKey(order), 'seq')).toBe('9');
    // Her yazim kendinden hemen onceki kaydi gorur: sonuc zinciri tutarli olmali.
    const accepted = versions.filter(
      (version, index) => previous[index] === undefined || version > (previous[index] ?? 0),
    );
    expect(Math.max(...accepted)).toBe(9);
  });
});

describe('uctan uca: olay hatti -> iki kopya -> istemciler', () => {
  let container: StartedRedisContainer;
  let publisher: RedisStreamsPublisher;
  let connection: RedisConnection;
  let nodes: Node[] = [];
  const clients: Socket[] = [];
  const lines: LogLine[] = [];

  async function clientIn(node: Node): Promise<Socket> {
    const socket = await connectClient(node.server.port);
    clients.push(socket);
    await joinRoom(socket, { room: ORDER_ROOM, token: await signRoomToken(Date.now()) });
    return socket;
  }

  beforeAll(async () => {
    container = await new RedisContainer(REDIS_IMAGE).start();
    const url = container.getConnectionUrl();
    connection = await connectRedis({ url });
    publisher = new RedisStreamsPublisher(connection.redis);
    // LATEST: kopyalar acilmadan once yazilan olay hic yayinlanmamali.
    await publisher.publish(statusEnvelope(1, 'RISK_CHECK', 'DRAFT'));
    const logger = recordingLogger(lines);
    nodes = await Promise.all([
      startNode(url, 'kopya-a', logger),
      startNode(url, 'kopya-b', logger),
    ]);
  });

  afterAll(async () => {
    for (const socket of clients) {
      socket.close();
    }
    await Promise.all(nodes.map(({ server }) => server.shutdown('test bitti')));
    await connection?.close();
    await container?.stop();
  });

  it('durum degisimi iki kopyadaki istemcilere bir kez ve 1 sn icinde ulasir; acilistan onceki olay gelmez', async () => {
    const [nodeA, nodeB] = nodes as [Node, Node];
    const [onA, onB] = await Promise.all([clientIn(nodeA), clientIn(nodeB)]);
    const receivedA: { at: number; payload: unknown }[] = [];
    const receivedB: { at: number; payload: unknown }[] = [];
    onA.on('order.status', (payload: unknown) => receivedA.push({ at: Date.now(), payload }));
    onB.on('order.status', (payload: unknown) => receivedB.push({ at: Date.now(), payload }));

    const sentAt = Date.now();
    await publisher.publish(statusEnvelope(2, 'RESERVED', 'RISK_CHECK'));
    await expect.poll(() => receivedA.length + receivedB.length, { timeout: 2_000 }).toBe(2);

    expect(receivedA.map((r) => r.payload)).toEqual([
      expect.objectContaining({
        orderId: ORDER_ID,
        status: 'RESERVED',
        previousStatus: 'RISK_CHECK',
        seq: 2,
      }) as unknown,
    ]);
    expect(receivedB.map((r) => r.payload)).toEqual(receivedA.map((r) => r.payload));
    expect(Math.max(...[...receivedA, ...receivedB].map((r) => r.at - sentAt))).toBeLessThan(1_000);
    // Ic alanlar sokete cikmaz.
    expect(JSON.stringify(receivedA)).not.toContain(USER_ID);
    onA.off('order.status');
    onB.off('order.status');
  });

  it('sirasiz teslim: eski surum yayinlanmaz; ayni surumun tekrari yeniden yayinlanir', async () => {
    const [nodeA] = nodes as [Node, Node];
    const onA = await clientIn(nodeA);
    const events = collectEvents(onA, 'order.status');

    // Uc kayit TEK MULTI ile yazilir: gruptaki tek bir kopya ucunu ayni partide,
    // sirayla okur. Ayri yazilsalardi iki kopyaya dagilip yaris olusturabilirdi.
    await connection.redis
      .multi()
      .xadd(
        EVENTS_STREAM_KEY,
        '*',
        ...toStreamFields(statusEnvelope(5, 'PAID', 'AWAITING_PAYMENT')),
      )
      .xadd(
        EVENTS_STREAM_KEY,
        '*',
        ...toStreamFields(statusEnvelope(4, 'AWAITING_PAYMENT', 'RESERVED')),
      )
      .xadd(
        EVENTS_STREAM_KEY,
        '*',
        ...toStreamFields(statusEnvelope(5, 'PAID', 'AWAITING_PAYMENT')),
      )
      .exec();

    // collectEvents SILENCE_MS bekler; uc olay yerelde onun cok altinda islenir.
    expect(seqsOf(await events)).toEqual([5, 5]);
    expect(SILENCE_MS).toBeGreaterThan(0);
  });

  it('olay zincirinin istek kimligi realtime gunlugunde (D16); olay bir kez islenir', () => {
    const published = lines.filter((line) => line.message === 'siparis durumu odaya yayinlandi');
    const stale = lines.filter((line) => line.message.startsWith('siparis durumu atlandi'));

    expect(published.length).toBeGreaterThan(0);
    expect(published.every((line) => line.fields['requestId'] === REQUEST_ID)).toBe(true);
    expect(stale).toHaveLength(1);
    // Acilistan onceki surum 1 hic islenmedi (LATEST).
    expect(lines.some((line) => line.fields['seq'] === 1)).toBe(false);
    // Her surum gruptaki TEK kopyada islenir: surum 2 iki kez yayinlanmadi.
    expect(published.filter((line) => line.fields['seq'] === 2)).toHaveLength(1);
  });
});
