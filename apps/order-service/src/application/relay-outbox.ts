/**
 * Use-case: outbox'taki yayinlanmamis olaylari hatta yayinlar (T7.3, ADR-04).
 * Zamanlayici interfaces/workers/outbox-publisher.ts'tedir; burasi TEK tur.
 *
 * Kurallar:
 *  - Sirayla yayinlanir; ilk hatada tur DURUR. Sonraki olay bir oncekini
 *    gecmesin: ayni siparisin "PAID"i "AWAITING_PAYMENT"inden once gitmez.
 *  - Yalnizca yayinlanan olaylar isaretlenir; kalanlar sonraki turda.
 *  - Teslimat EN AZ BIR KEZDIR: yayinla ile isaretle arasinda cokulurse olay
 *    tekrar gider. Tuketici eventId ile tekillestirir.
 */

import type { Clock, Logger } from '@getir/core';
import { eventEnvelopeSchema } from '@getir/event-bus';
import type { EventEnvelope, EventPublisher } from '@getir/event-bus';

import type { OrderEvent } from '../domain/order-events.js';
import type { OrderOutbox } from '../domain/order-outbox.js';

export interface RelayOutboxDeps {
  readonly outbox: Pick<OrderOutbox, 'pending' | 'markPublished'>;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  /** Bir turda en fazla kac olay yayinlanir. */
  readonly batchSize: number;
}

/** @returns Bu turda yayinlanan olay sayisi. */
export type RelayOutbox = (logger: Logger) => Promise<number>;

export function createRelayOutbox(deps: RelayOutboxDeps): RelayOutbox {
  return async (logger) => {
    const pending = await deps.outbox.pending(deps.batchSize);
    const published: string[] = [];
    try {
      for (const event of pending) {
        await deps.publisher.publish(toEnvelope(event));
        published.push(event.eventId);
      }
    } catch (error: unknown) {
      const failed = pending[published.length];
      logger.warn(
        { err: error, eventId: failed?.eventId, topic: failed?.topic },
        'olay yayinlanamadi; sonraki turda tekrar denenecek',
      );
    } finally {
      await deps.outbox.markPublished(published, deps.clock.date());
    }
    return published.length;
  };
}

/**
 * Domain olayi -> hat zarfi (ADR-07). Zarf semadan gecer: bozuk olay hatta
 * girmez, tur durur ve hata gunlukte gorunur.
 */
function toEnvelope(event: OrderEvent): EventEnvelope {
  return eventEnvelopeSchema.parse({
    eventId: event.eventId,
    topic: event.topic,
    partitionKey: event.orderId,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
  });
}
