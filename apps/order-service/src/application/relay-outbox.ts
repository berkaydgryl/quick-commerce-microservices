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
 *
 * Tur sonucu isciye metrik icin doner (T10.5, #12): yayinlanan sayisi, yayinin
 * yarida kalip kalmadigi ve turun gordugu en eski olayin yasi (gecikme).
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

export interface RelayRound {
  /** Bu turda yayinlanan olay sayisi. */
  readonly published: number;
  /** Yayin yarida kaldi (hat hatasi); kalanlar sonraki turda. */
  readonly failed: boolean;
  /**
   * Turun okudugu en eski yayinlanmamis olayin yasi (ms); kuyruk bossa 0.
   * Saglikli yayinda tur araliginin altinda kalir, buyumesi takilmayi gosterir.
   */
  readonly lagMs: number;
}

export type RelayOutbox = (logger: Logger) => Promise<RelayRound>;

export function createRelayOutbox(deps: RelayOutboxDeps): RelayOutbox {
  return async (logger) => {
    const pending = await deps.outbox.pending(deps.batchSize);
    const lagMs = lagOf(pending[0], deps.clock.now());
    const published: string[] = [];
    let failed = false;
    try {
      for (const event of pending) {
        await deps.publisher.publish(toEnvelope(event));
        published.push(event.eventId);
      }
    } catch (error: unknown) {
      failed = true;
      const stuck = pending[published.length];
      logger.warn(
        { err: error, eventId: stuck?.eventId, topic: stuck?.topic },
        'olay yayinlanamadi; sonraki turda tekrar denenecek',
      );
    } finally {
      await deps.outbox.markPublished(published, deps.clock.date());
    }
    return { published: published.length, failed, lagMs };
  };
}

/** En eski bekleyenin yasi; saat geri kaysa da negatif olmaz. */
function lagOf(oldest: OrderEvent | undefined, nowMs: number): number {
  return oldest === undefined ? 0 : Math.max(0, nowMs - oldest.occurredAt.getTime());
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
