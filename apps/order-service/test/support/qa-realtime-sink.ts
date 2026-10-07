/**
 * QA (T15.2, OQ2): realtime'in GERCEK tuketicisi, order'in akisina bagli. Konu kaydi uretimdeki
 * subscribeRealtimeEvents (events.ts); zincir: isleyici (govde dogrulama) -> use-case (surum
 * karari) -> Redis surum deposu (MULTI + ZADD GT) -> yayin kapisi (soket sozlesmesi). Yalnizca
 * Socket.io yerine yakalayan bir yayinci var: odaya giden olaylar sirasiyla `emitted`te.
 *
 * Akistaki zarflar YAYIN SIRASIYLA verilir (tekrarlar dahil): tuketici gruba ne gelirse onu gorur;
 * realtime'in dinlemedigi konu atlanir.
 */

import type { OrderStatusEvent } from '@getir/contracts';
import { orderStatusEventSchema } from '@getir/contracts';
import { silentLogger } from '@getir/core';
import type { EventHandler, EventOutcome } from '@getir/event-bus';
import type { RedisConnection } from '@getir/redis-kit';

import { createBroadcast } from '../../../realtime-service/src/application/broadcast.js';
import { createPublishOrderStatus } from '../../../realtime-service/src/application/publish-order-status.js';
import { SEQ_TTL_MS } from '../../../realtime-service/src/config/constants.js';
import { subscribeRealtimeEvents } from '../../../realtime-service/src/events.js';
import { createRedisSeqStore } from '../../../realtime-service/src/infrastructure/redis-seq-store.js';
import type { Published } from './qa-order-cluster.js';

export interface RealtimeSink {
  /** Akistaki zarflari sirayla realtime'in isleyicilerine verir; sonuclar. */
  deliver(stream: readonly Published[]): Promise<readonly EventOutcome[]>;
  /** Odalara giden soket olaylari (order.status), yayin sirasiyla. */
  readonly emitted: readonly OrderStatusEvent[];
  /** Daha yeni surum yayinlanmis oldugu icin atlanan olay sayisi (realtime'in metrigi). */
  stale(): number;
  /** Atilan (soket sozlesmesine uymayan) olay sayisi. */
  dropped(): number;
}

export function realtimeSink(redis: RedisConnection['redis']): RealtimeSink {
  const emitted: OrderStatusEvent[] = [];
  let stale = 0;
  let dropped = 0;
  const broadcast = createBroadcast({
    emitter: {
      emit: (_room, _event, payload) => {
        emitted.push(orderStatusEventSchema.parse(payload));
      },
    },
    metrics: {
      eventEmitted: () => undefined,
      eventDropped: () => {
        dropped += 1;
      },
    },
    logger: silentLogger,
  });
  const handlers = new Map<string, EventHandler>();
  subscribeRealtimeEvents(
    { subscribe: (topic, _group, handler) => handlers.set(topic, handler) },
    {
      publish: createPublishOrderStatus({
        seqStore: createRedisSeqStore({ redis, ttlMs: SEQ_TTL_MS }),
        broadcast,
        metrics: {
          eventStale: () => {
            stale += 1;
          },
        },
      }),
    },
  );
  return {
    deliver: async (stream) => {
      const outcomes: EventOutcome[] = [];
      for (const { envelope } of stream) {
        const handler = handlers.get(envelope.topic);
        if (handler === undefined) continue;
        outcomes.push(await handler(envelope, { attempt: 1, logger: silentLogger }));
      }
      return outcomes;
    },
    emitted,
    stale: () => stale,
    dropped: () => dropped,
  };
}
