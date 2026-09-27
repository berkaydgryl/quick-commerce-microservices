/**
 * Siparis olaylarinin turetilmesi (T7.3): saf, I/O yok.
 */

import { EVENTS, fixedClock, ID_PREFIX, isId, ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  orderCreatedEvents,
  refundRequestedEvent,
  statusChangedEvents,
} from '../../src/domain/order-events.js';
import { createDraftOrder, TIMELINE_NOTE, transitionOrder } from '../../src/domain/order.js';
import { sampleDraftInput, SAMPLE_PRICING } from '../support/order-builders.js';

const T0 = 1_760_000_000_000;
const draft = () => createDraftOrder(sampleDraftInput(), fixedClock(T0));

describe('orderCreatedEvents', () => {
  it('tek order.created: siparisin kimligi, sahibi, marketi, tutari ve surumu', () => {
    const order = draft();

    const [event, ...rest] = orderCreatedEvents(order);

    expect(rest).toEqual([]);
    expect(isId(ID_PREFIX.EVENT, event?.eventId)).toBe(true);
    expect(event).toMatchObject({
      topic: EVENTS.ORDER_CREATED,
      orderId: order.id,
      version: 1,
      occurredAt: new Date(T0),
      payload: {
        orderId: order.id,
        userId: 'usr_1',
        marketId: 'mkt_migros-jet-moda',
        status: 'DRAFT',
        totalMinor: SAMPLE_PRICING.totalMinor,
        currency: 'TRY',
        version: 1,
      },
    });
  });
});

describe('statusChangedEvents', () => {
  it('tek yazimdaki her gecis ayri olay: from/to zinciri, surum ve zaman gecisten', () => {
    const before = draft();
    const after = [
      ORDER_STATUS.RISK_CHECK,
      ORDER_STATUS.RESERVED,
      ORDER_STATUS.AWAITING_PAYMENT,
    ].reduce(
      (order, status, index) =>
        transitionOrder(
          order,
          status,
          fixedClock(T0 + (index + 1) * 1_000),
          status === ORDER_STATUS.RESERVED ? TIMELINE_NOTE.PENDING_RESERVATION : undefined,
        ),
      before,
    );

    const events = statusChangedEvents(before, after);

    expect(
      events.map((event) => [event.payload['from'], event.payload['to'], event.version]),
    ).toEqual([
      ['DRAFT', 'RISK_CHECK', 2],
      ['RISK_CHECK', 'RESERVED', 3],
      ['RESERVED', 'AWAITING_PAYMENT', 4],
    ]);
    expect(events.map((event) => event.occurredAt.getTime())).toEqual([
      T0 + 1_000,
      T0 + 2_000,
      T0 + 3_000,
    ]);
    expect(events.every((event) => event.topic === EVENTS.ORDER_STATUS_CHANGED)).toBe(true);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(3);
    // Not yalnizca olan geciste tasinir; son olay siparisin surumunu tasir.
    expect(events[1]?.payload['note']).toBe('PENDING_RESERVATION');
    expect(events[0]?.payload).not.toHaveProperty('note');
    expect(events.at(-1)?.version).toBe(after.version);
  });

  it('gecis yoksa olay yok', () => {
    const order = draft();

    expect(statusChangedEvents(order, order)).toEqual([]);
  });
});

describe('refundRequestedEvent', () => {
  it('telafi komutu: siparisin kimligi ve surumu, gerekce ve iade anahtari', () => {
    const order = draft();

    expect(
      refundRequestedEvent(
        order,
        { reason: 'order_changed_during_payment', idempotencyKey: `refund-${order.id}` },
        new Date(T0 + 5),
      ),
    ).toMatchObject({
      topic: EVENTS.PAYMENT_REFUND_REQUESTED,
      orderId: order.id,
      version: order.version,
      occurredAt: new Date(T0 + 5),
      payload: {
        orderId: order.id,
        reason: 'order_changed_during_payment',
        idempotencyKey: `refund-${order.id}`,
      },
    });
  });
});
