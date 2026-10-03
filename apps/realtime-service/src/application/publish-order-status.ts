/**
 * Siparis durum degisimini odaya yayinlar (T12.3).
 *
 * Sira: ceviri -> surum kaydi (atomik) -> karar -> yayin. Surum, yayindan ONCE
 * kaydedilir: iki kopya ayni siparisin iki surumunu ayni anda islerse eskisi
 * yayinlanmaz. Kayittan sonra cokulurse olay onaylanmamis kalir ve yeniden
 * teslim edilir; esit surum yeniden yayinlandigi icin (domain/seq.ts) kayip olmaz.
 *
 * Use-case Socket.io'yu ve Redis'i bilmez: yayin kapisi (broadcast.ts) ve
 * surum deposu (seq-store.ts) disaridan verilir.
 */

import { orderRoom, SOCKET_EVENTS } from '@getir/contracts';
import type { OrderStatusChangedPayload } from '@getir/contracts';

import { toOrderStatusEvent } from '../domain/order-status-event.js';
import { decideSeq, SEQ_DECISION } from '../domain/seq.js';
import type { SeqDecision } from '../domain/seq.js';
import type { Broadcast } from './broadcast.js';
import type { SeqStore } from './seq-store.js';

/** Sonuc; gunluk ve test icin. `dropped`: yayin kapisi sozlesme disi buldu. */
export const PUBLISH_OUTCOME = {
  PUBLISHED: 'published',
  REPUBLISHED: 'republished',
  STALE: 'stale',
  DROPPED: 'dropped',
} as const;

export type PublishOutcome = (typeof PUBLISH_OUTCOME)[keyof typeof PUBLISH_OUTCOME];

export interface StaleMetrics {
  /** Daha yeni surum zaten yayinlandigi icin atlanan olay. */
  eventStale(event: typeof SOCKET_EVENTS.ORDER_STATUS): void;
}

export interface PublishOrderStatusDeps {
  readonly seqStore: SeqStore;
  readonly broadcast: Broadcast;
  readonly metrics: StaleMetrics;
}

export interface OrderStatusChange {
  readonly payload: OrderStatusChangedPayload;
  /** Zarfin occurredAt'i (ISO 8601). */
  readonly occurredAt: string;
}

export type PublishOrderStatus = (
  change: OrderStatusChange,
) => Promise<{ readonly outcome: PublishOutcome; readonly decision: SeqDecision }>;

export function createPublishOrderStatus(deps: PublishOrderStatusDeps): PublishOrderStatus {
  return async ({ payload, occurredAt }) => {
    const event = toOrderStatusEvent(payload, occurredAt);
    const previous = await deps.seqStore.recordIfNewer(event.orderId, event.seq);
    const decision = decideSeq(previous, event.seq);
    if (decision === SEQ_DECISION.STALE) {
      deps.metrics.eventStale(SOCKET_EVENTS.ORDER_STATUS);
      return { outcome: PUBLISH_OUTCOME.STALE, decision };
    }
    const emitted = deps.broadcast(orderRoom(event.orderId), SOCKET_EVENTS.ORDER_STATUS, event);
    if (!emitted) {
      return { outcome: PUBLISH_OUTCOME.DROPPED, decision };
    }
    return {
      outcome:
        decision === SEQ_DECISION.SAME ? PUBLISH_OUTCOME.REPUBLISHED : PUBLISH_OUTCOME.PUBLISHED,
      decision,
    };
  };
}
