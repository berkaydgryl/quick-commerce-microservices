/**
 * QA kara kutu duzenegi (T12.3): gercek Redis (Testcontainers), olay dinleyen
 * realtime kopyalari, event-bus'in gercek yayincisi ve istemci tarafinda varis
 * kaydi. Olaylar order'in yazdigi bicimde (zarf + order.status_changed govdesi)
 * stream:events'e yazilir; realtime'a ic yoldan hicbir sey verilmez.
 */

import { EVENTS, ID_PREFIX, newId, silentLogger } from '@getir/core';
import type { Logger } from '@getir/core';
import { orderRoom } from '@getir/contracts';
import { RedisStreamsPublisher } from '@getir/event-bus';
import type { DeliverySettings, EventEnvelope } from '@getir/event-bus';
import { connectRedis, EVENTS_DEAD_LETTER_STREAM_KEY, EVENTS_STREAM_KEY } from '@getir/redis-kit';
import type { RedisConnection } from '@getir/redis-kit';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { Socket } from 'socket.io-client';
import { expect } from 'vitest';

import { startRealtimeServer } from '../../src/bootstrap.js';
import type { RealtimeServer } from '../../src/bootstrap.js';
import { EVENT_CONSUMER_GROUP } from '../../src/config/constants.js';
import { startEventConsuming } from '../../src/events.js';
import { openRedisAdapter } from '../../src/infrastructure/redis-adapter.js';
import { connectClient, joinRoom } from './clients.js';
import { signRoomToken, TEST_SECRET, USER_ID } from './tokens.js';

/** infra/docker/docker-compose.dev.yml ile ayni surum. */
export const REDIS_IMAGE = 'redis:7-alpine';

/** Belgedeki hedef (socket-events.md "order.status teslimi"): gecisten istemciye. */
export const DELIVERY_TARGET_MS = 1_000;

export const MARKET_ID = 'mkt_migros-jet-moda';

/** Testin Redis'i: konteyner, komut baglantisi ve yayinci. */
export interface QaRedis {
  readonly url: string;
  readonly connection: RedisConnection;
  readonly publisher: RedisStreamsPublisher;
  stop(): Promise<void>;
}

export async function startQaRedis(): Promise<QaRedis> {
  const container: StartedRedisContainer = await new RedisContainer(REDIS_IMAGE).start();
  const url = container.getConnectionUrl();
  const connection = await connectRedis({ url });
  return {
    url,
    connection,
    publisher: new RedisStreamsPublisher(connection.redis),
    stop: async () => {
      await connection.close();
      await container.stop();
    },
  };
}

export interface QaNodeOptions {
  /** Grupta tekil tuketici adi. */
  readonly name: string;
  /** false: olay dinlemeyen kopya (yalnizca istemci ve adapter). Varsayilan true. */
  readonly listens?: boolean;
  /** Verilmezse URETIM teslim ayarlari (event-bus varsayilanlari + LATEST). */
  readonly delivery?: Partial<DeliverySettings>;
  readonly logger?: Logger;
}

/** main.ts'in kurdugu bicimde bir realtime kopyasi (adapter + istege bagli olay dinleme). */
export async function startQaNode(
  redisUrl: string,
  options: QaNodeOptions,
): Promise<RealtimeServer> {
  const logger = options.logger ?? silentLogger;
  const redis = { REDIS_URL: redisUrl, REDIS_CONNECT_TIMEOUT_MS: 5_000 };
  const adapter = await openRedisAdapter({ redis, logger });
  return startRealtimeServer({
    host: '127.0.0.1',
    port: 0,
    logger,
    tokenSecret: TEST_SECRET,
    adapter,
    ...(options.listens === false
      ? {}
      : {
          events: (broadcast) =>
            startEventConsuming(
              {
                redis,
                adapter,
                consumerName: options.name,
                logger,
                ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
              },
              broadcast,
            ),
        }),
  });
}

export interface StatusChange {
  readonly orderId: string;
  readonly version: number;
  readonly to: string;
  readonly from?: string;
  /** Verilmezse simdi. */
  readonly occurredAt?: string;
  /** Govdeye eklenecek alanlar (ic alanlar ya da bozuk deger). */
  readonly extra?: Record<string, unknown>;
}

/** order'in outbox'tan yazdigi zarf: order.status_changed. */
export function statusEnvelope(change: StatusChange): EventEnvelope {
  return {
    eventId: newId(ID_PREFIX.EVENT),
    topic: EVENTS.ORDER_STATUS_CHANGED,
    partitionKey: change.orderId,
    occurredAt: change.occurredAt ?? new Date().toISOString(),
    payload: {
      orderId: change.orderId,
      userId: USER_ID,
      marketId: MARKET_ID,
      ...(change.from === undefined ? {} : { from: change.from }),
      to: change.to,
      version: change.version,
      ...change.extra,
    },
  };
}

/** Siparisin odasina gecerli jetonla katilmis istemci. */
export async function orderClient(port: number, orderId: string): Promise<Socket> {
  const socket = await connectClient(port);
  const room = orderRoom(orderId);
  await expect(
    joinRoom(socket, { room, token: await signRoomToken(Date.now(), { room }) }),
  ).resolves.toMatchObject({ success: true });
  return socket;
}

export interface Arrival {
  readonly at: number;
  readonly payload: Record<string, unknown>;
}

/** Istemcinin aldigi order.status olaylarini varis aniyla kaydeder. */
export function recordArrivals(socket: Socket): Arrival[] {
  const arrivals: Arrival[] = [];
  socket.on('order.status', (payload: Record<string, unknown>) => {
    arrivals.push({ at: Date.now(), payload });
  });
  return arrivals;
}

export function seqsOf(arrivals: readonly Arrival[]): number[] {
  return arrivals.map((arrival) => Number(arrival.payload['seq']));
}

/** Grubun (ya da tek tuketicinin) onaylanmamis kayit sayisi. */
export async function pendingCount(
  redis: RedisConnection['redis'],
  consumer?: string,
): Promise<number> {
  const exists = await redis.exists(EVENTS_STREAM_KEY);
  if (exists === 0) {
    return 0;
  }
  if (consumer === undefined) {
    const summary: unknown = await redis.xpending(EVENTS_STREAM_KEY, EVENT_CONSUMER_GROUP);
    return Array.isArray(summary) ? Number(summary[0]) : 0;
  }
  const entries: unknown = await redis.xpending(
    EVENTS_STREAM_KEY,
    EVENT_CONSUMER_GROUP,
    '-',
    '+',
    1_000,
    consumer,
  );
  return Array.isArray(entries) ? entries.length : 0;
}

/** Olu olaylar akisindaki kayitlar, alan -> deger. */
export async function deadLetters(
  redis: RedisConnection['redis'],
): Promise<Record<string, string>[]> {
  const entries = await redis.xrange(EVENTS_DEAD_LETTER_STREAM_KEY, '-', '+');
  return entries.map(([, fields]) => {
    const record: Record<string, string> = {};
    for (let index = 0; index + 1 < fields.length; index += 2) {
      record[fields[index] ?? ''] = fields[index + 1] ?? '';
    }
    return record;
  });
}

/** Siparis durumlari: gecislerde sirayla kullanilir (realtime gecis kuralina bakmaz). */
export const STATUS_CYCLE = [
  'RISK_CHECK',
  'RESERVED',
  'AWAITING_PAYMENT',
  'PAID',
  'PREPARING',
  'ON_THE_WAY',
] as const;

/** version'a gore durum ve onceki durum (zincir tutarli olsun). */
export function transition(orderId: string, version: number): StatusChange {
  const to = STATUS_CYCLE[(version - 2 + STATUS_CYCLE.length) % STATUS_CYCLE.length] ?? 'PAID';
  const from =
    version === 2
      ? 'DRAFT'
      : (STATUS_CYCLE[(version - 3 + STATUS_CYCLE.length) % STATUS_CYCLE.length] ?? 'DRAFT');
  return { orderId, version, to, from };
}

export function newOrderId(): string {
  return newId(ID_PREFIX.ORDER);
}
