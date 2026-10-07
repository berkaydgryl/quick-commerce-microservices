/**
 * Kurye kilometre tasi testlerinin ortak verisi (T14.3): courier'in
 * yayinladigi zarflarin aynisi (govde sozlesme tipinden) ve kuryesi yazilmis
 * siparis.
 */

import type { CourierDeliveredPayload, CourierPickedUpPayload } from '@getir/contracts';
import { EVENTS, ID_PREFIX, newId } from '@getir/core';
import type { Clock } from '@getir/core';
import type { EventEnvelope } from '@getir/event-bus';

import { withAssignedCourier } from '../../src/domain/courier-dispatch.js';
import { statusChangedEvents } from '../../src/domain/order-events.js';
import type { OrderRepository } from '../../src/domain/order-repository.js';
import type { DraftOrderInput, Order } from '../../src/domain/order.js';
import { insertPaid } from './order-builders.js';

export const newCourierId = (): string => newId(ID_PREFIX.COURIER);

/** courier.picked_up zarfi; override ile bozuk ya da fazla alanli govde denenir. */
export function pickedUpEvent(
  order: Pick<Order, 'id' | 'marketId'>,
  courierId: string,
  at: Date,
  override: Record<string, unknown> = {},
): EventEnvelope {
  const payload: CourierPickedUpPayload = {
    orderId: order.id,
    courierId,
    marketId: order.marketId,
  };
  return envelope(EVENTS.COURIER_PICKED_UP, order.id, at, { ...payload, ...override });
}

/** courier.delivered zarfi. */
export function deliveredEvent(
  order: Pick<Order, 'id'>,
  courierId: string,
  at: Date,
  override: Record<string, unknown> = {},
): EventEnvelope {
  const payload: CourierDeliveredPayload = { orderId: order.id, courierId };
  return envelope(EVENTS.COURIER_DELIVERED, order.id, at, { ...payload, ...override });
}

function envelope(
  topic: EventEnvelope['topic'],
  orderId: string,
  at: Date,
  payload: Record<string, unknown>,
): EventEnvelope {
  return {
    eventId: newId(ID_PREFIX.EVENT),
    topic,
    partitionKey: orderId,
    occurredAt: at.toISOString(),
    payload,
  };
}

/** Odenmis ve kurye atanmis (PREPARING, kuryeli) siparis; kurye iscisinin yazimi gibi. */
export async function insertWithCourier(
  repository: Pick<OrderRepository, 'insert' | 'update'>,
  clock: Clock,
  courierId: string,
  overrides: Partial<DraftOrderInput> = {},
): Promise<Order> {
  const paid = await insertPaid(repository, clock, overrides);
  return assignCourier(repository, paid, courierId, clock);
}

/** Odenmis siparise kurye yazar (PAID -> PREPARING, kuryeli). */
export async function assignCourier(
  repository: Pick<OrderRepository, 'update'>,
  paid: Order,
  courierId: string,
  clock: Clock,
): Promise<Order> {
  const preparing = withAssignedCourier(paid, courierId, clock);
  await repository.update(preparing, paid.version, statusChangedEvents(paid, preparing));
  return preparing;
}
