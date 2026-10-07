/**
 * RouteEventPublisher'in olay hatti uygulamasi (T13.3): courier.picked_up ve
 * courier.delivered zarfla stream:events'e (ADR-07). Govde @getir/contracts
 * semasindan gecer: tuketici (order, T14.3) ayni semayla okur.
 *
 * Zarfin an'i kilometre tasinin anidir (rotadan hesaplanan), yayin ani degil.
 * Bolum anahtari siparis: ayni siparisin olaylari ayni bolumde. Istek
 * baglami yoktur (tick bir istek degil): requestId ve traceparent bos.
 * Sozlesme disi govde hatta girmez: yayin REDDEDILIR (Promise), tur hatayi gorur.
 *
 * Olay kimligi BELIRLENIMCIDIR (milestoneEventId): yeniden yayin (en az bir
 * kez) ayni kimligi tasir, tuketici eventId ile tekillestirebilir (ADR-04).
 */

import { createHash } from 'node:crypto';

import { EVENTS, ID_PREFIX } from '@getir/core';
import type { EventName, PrefixedId } from '@getir/core';
import { courierDeliveredPayloadSchema, courierPickedUpPayloadSchema } from '@getir/contracts';
import type { EventPublisher } from '@getir/event-bus';

import type { Route } from '../../domain/route.js';
import type { RouteEventPublisher } from '../../domain/route-events.js';

/** Kimlik govdesi: evt_<32 hex>, rastgele kimlikle ayni bicim. */
const EVENT_ID_BODY_LENGTH = 32;

/**
 * Kilometre tasinin olay kimligi: (siparis, rotanin uretildigi an, konu).
 * Ayni rotanin ayni tasi her denemede ayni kimligi alir; yeniden atamada rota
 * yenilenir (yeni an), olay da yeni kimlik alir.
 */
export function milestoneEventId(
  route: Pick<Route, 'orderId' | 'createdAt'>,
  topic: EventName,
): PrefixedId<typeof ID_PREFIX.EVENT> {
  const body = createHash('sha256')
    .update(`${route.orderId}|${route.createdAt.toISOString()}|${topic}`)
    .digest('hex')
    .slice(0, EVENT_ID_BODY_LENGTH);
  return `${ID_PREFIX.EVENT}_${body}`;
}

export class EventBusRouteEvents implements RouteEventPublisher {
  constructor(private readonly publisher: EventPublisher) {}

  async pickedUp(route: Route & { readonly marketId: string }, at: Date): Promise<void> {
    await this.publish(
      EVENTS.COURIER_PICKED_UP,
      route,
      at,
      courierPickedUpPayloadSchema.parse({
        orderId: route.orderId,
        courierId: route.courierId,
        marketId: route.marketId,
      }),
    );
  }

  async delivered(route: Route, at: Date): Promise<void> {
    await this.publish(
      EVENTS.COURIER_DELIVERED,
      route,
      at,
      courierDeliveredPayloadSchema.parse({ orderId: route.orderId, courierId: route.courierId }),
    );
  }

  private publish(
    topic: EventName,
    route: Route,
    at: Date,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.publisher.publish({
      eventId: milestoneEventId(route, topic),
      topic,
      partitionKey: route.orderId,
      occurredAt: at.toISOString(),
      payload,
    });
  }
}
