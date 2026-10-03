/**
 * Olay hatti baglantisi (T12.3): stream:events -> order.status (DI, elle).
 *
 * Realtime "realtime" grubunda order.status_changed'i dinler. Grup ilk kez
 * kurulurken yalnizca BUNDAN SONRAKI olaylari okur (GROUP_START.LATEST): eski
 * durum degisimlerinin anlami yoktur, istemci baglaninca durumu
 * GET /v1/orders/{id} ile zaten okur. Grup kurulduktan sonra kapali kalinan
 * surenin olaylari islenir (grup akista kaldigi yerden devam eder); sonucu
 * degistirmez, istemci seq kuralini uygular.
 *
 * Tuketici kendi Redis baglantisini acar (event-bus: grup basina bir); surum
 * deposu adapter'in yayin baglantisini paylasir (D5).
 */

import { EVENTS } from '@getir/core';
import type { Logger } from '@getir/core';
import { GROUP_START, RedisStreamsConsumer } from '@getir/event-bus';
import type { DeliverySettings, EventSubscriber } from '@getir/event-bus';
import { connectRedis } from '@getir/redis-kit';
import type { RedisEnv } from '@getir/redis-kit';

import type { Broadcast } from './application/broadcast.js';
import { createPublishOrderStatus } from './application/publish-order-status.js';
import type { PublishOrderStatus } from './application/publish-order-status.js';
import { EVENT_CONSUMER_GROUP, REDIS_CONNECTION_NAME, SEQ_TTL_MS } from './config/constants.js';
import type { RedisAdapterHandle } from './infrastructure/redis-adapter.js';
import { createRedisSeqStore } from './infrastructure/redis-seq-store.js';
import { realtimeMetrics } from './interfaces/metrics.js';
import { createOrderStatusChangedHandler } from './interfaces/workers/order-status-changed.js';

/** Calisan olay dinlemesi; kapanista durdurulur. */
export interface EventConsuming {
  /** Yeni okuma baslamaz, eldeki parti bitirilir, baglanti kapanir. */
  stop(): Promise<void>;
}

/** Realtime'in dinledigi konular ve isleyicileri (dinleme baslamadan kaydedilir). */
export function subscribeRealtimeEvents(
  subscriber: EventSubscriber,
  deps: { readonly publish: PublishOrderStatus },
): void {
  subscriber.subscribe(
    EVENTS.ORDER_STATUS_CHANGED,
    EVENT_CONSUMER_GROUP,
    createOrderStatusChangedHandler(deps),
  );
}

export interface EventConsumingOptions {
  readonly redis: RedisEnv;
  /** Surum deposunun komut baglantisi: adapter'in yayin baglantisi (D5). */
  readonly adapter: RedisAdapterHandle;
  /** Grupta tekil tuketici adi (makine + pid). */
  readonly consumerName: string;
  readonly logger: Logger;
  /** Testler okuma beklemesini ya da akisi degistirir; uretimde varsayilan. */
  readonly delivery?: Partial<DeliverySettings>;
  readonly streamKey?: string;
}

/** Tuketiciyi kurar, aboneyi kaydeder ve dinlemeyi baslatir. */
export async function startEventConsuming(
  options: EventConsumingOptions,
  broadcast: Broadcast,
): Promise<EventConsuming> {
  const consumer = new RedisStreamsConsumer({
    connect: () =>
      connectRedis({
        url: options.redis.REDIS_URL,
        connectTimeoutMs: options.redis.REDIS_CONNECT_TIMEOUT_MS,
        name: REDIS_CONNECTION_NAME.EVENTS,
        logger: options.logger,
      }),
    consumerName: options.consumerName,
    logger: options.logger,
    delivery: { groupStart: GROUP_START.LATEST, ...options.delivery },
    ...(options.streamKey === undefined ? {} : { streamKey: options.streamKey }),
  });
  subscribeRealtimeEvents(consumer, {
    publish: createPublishOrderStatus({
      seqStore: createRedisSeqStore({ redis: options.adapter.commands, ttlMs: SEQ_TTL_MS }),
      broadcast,
      metrics: realtimeMetrics,
    }),
  });
  await consumer.start();
  return { stop: () => consumer.stop() };
}
