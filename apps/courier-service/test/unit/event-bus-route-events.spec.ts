/**
 * Kilometre tasi olaylarinin zarfi (T13.3): konu, bolum anahtari (siparis),
 * an (kilometre tasinin ani) ve sozlesmedeki govde. order (T14.3) bu govdeyi
 * @getir/contracts semasiyla okur.
 */

import { EVENTS, ID_PREFIX, isId } from '@getir/core';
import { courierDeliveredPayloadSchema, courierPickedUpPayloadSchema } from '@getir/contracts';
import { eventEnvelopeSchema, InMemoryEventPublisher } from '@getir/event-bus';
import { describe, expect, it } from 'vitest';

import type { Route } from '../../src/domain/route.js';
import {
  EventBusRouteEvents,
  milestoneEventId,
} from '../../src/infrastructure/events/event-bus-route-events.js';
import { courierId, MARKET, NOW_MS, orderId } from '../support/couriers.js';

const route: Route = {
  orderId: orderId(),
  courierId: courierId(1),
  points: [{ lat: 40.985, lng: 29.0275 }],
  pickupIndex: 0,
  distanceMeters: 0,
  etaSeconds: 0,
  createdAt: new Date(NOW_MS),
  marketId: MARKET,
};

describe('EventBusRouteEvents', () => {
  it('courier.picked_up: siparis bolum anahtari, an alma ani, govde sozlesmeden', async () => {
    const publisher = new InMemoryEventPublisher();
    const at = new Date(NOW_MS + 90_000);

    await new EventBusRouteEvents(publisher).pickedUp({ ...route, marketId: MARKET }, at);

    const [envelope] = publisher.published;
    expect(eventEnvelopeSchema.parse(envelope)).toMatchObject({
      topic: EVENTS.COURIER_PICKED_UP,
      partitionKey: route.orderId,
      occurredAt: at.toISOString(),
    });
    expect(courierPickedUpPayloadSchema.parse(envelope?.payload)).toEqual({
      orderId: route.orderId,
      courierId: route.courierId,
      marketId: MARKET,
    });
  });

  it('courier.delivered: govde siparis ve kurye; YENIDEN YAYIN AYNI olay kimligini tasir (tekillestirme)', async () => {
    const publisher = new InMemoryEventPublisher();
    const at = new Date(NOW_MS + 300_000);
    const events = new EventBusRouteEvents(publisher);

    await events.delivered(route, at);
    await events.delivered(route, at);

    const [first, second] = publisher.published;
    expect(first?.topic).toBe(EVENTS.COURIER_DELIVERED);
    expect(courierDeliveredPayloadSchema.parse(first?.payload)).toEqual({
      orderId: route.orderId,
      courierId: route.courierId,
    });
    expect(second?.eventId).toBe(first?.eventId);
    expect(first?.eventId).toBe(milestoneEventId(route, EVENTS.COURIER_DELIVERED));
  });

  it('olay kimligi: tas basina ayri; yeniden atamada (yeni rota ani) yeni; bicim evt_<32 hex>', () => {
    const delivered = milestoneEventId(route, EVENTS.COURIER_DELIVERED);
    const pickedUp = milestoneEventId(route, EVENTS.COURIER_PICKED_UP);
    const reassigned = milestoneEventId(
      { ...route, createdAt: new Date(NOW_MS + 60_000) },
      EVENTS.COURIER_DELIVERED,
    );
    const otherOrder = milestoneEventId({ ...route, orderId: orderId() }, EVENTS.COURIER_DELIVERED);

    expect(new Set([delivered, pickedUp, reassigned, otherOrder]).size).toBe(4);
    for (const id of [delivered, pickedUp, reassigned, otherOrder]) {
      expect(isId(ID_PREFIX.EVENT, id)).toBe(true);
    }
  });

  it('sozlesme disi govde HATTA GIRMEZ: bicimsiz kurye kimligi yayinlanmadan reddedilir', async () => {
    const publisher = new InMemoryEventPublisher();

    await expect(
      new EventBusRouteEvents(publisher).delivered(
        { ...route, courierId: 'usr_1' },
        new Date(NOW_MS),
      ),
    ).rejects.toThrow();
    expect(publisher.published).toEqual([]);
  });
});
