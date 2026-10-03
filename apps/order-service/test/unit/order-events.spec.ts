/**
 * Siparis olaylarinin turetilmesi (T7.3): saf, I/O yok.
 */

import {
  orderStatusChangedPayloadSchema,
  paymentCancelRequestedPayloadSchema,
  refundRequestedPayloadSchema,
} from '@getir/contracts';
import { EVENTS, fixedClock, ID_PREFIX, isId, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { REFUND_REASON, refundIdempotencyKey } from '../../src/domain/checkout-payment.js';
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

  it('govde realtime in okudugu sozlesme semasindan gecer (T12.3)', () => {
    // Sozlesme gercek kimlik bicimi ister; ortak ornek kisa kimlik (usr_1) kullaniyor.
    const before = createDraftOrder(
      sampleDraftInput({ userId: 'usr_0123456789abcdef0123456789abcdef' }),
      fixedClock(T0),
    );
    const after = transitionOrder(
      transitionOrder(before, ORDER_STATUS.RISK_CHECK, fixedClock(T0 + 1_000)),
      ORDER_STATUS.CANCELLED,
      fixedClock(T0 + 2_000),
      TIMELINE_NOTE.CART_RELEASED,
    );

    const payloads = statusChangedEvents(before, after)
      .filter((event) => event.topic === EVENTS.ORDER_STATUS_CHANGED)
      .map((event) => event.payload);

    expect(payloads.map((payload) => orderStatusChangedPayloadSchema.parse(payload))).toEqual(
      payloads,
    );
  });
});

describe('statusChangedEvents - payment.cancel_requested (T11.2 PR 3)', () => {
  const clock = fixedClock(T0);
  const walk = (steps: readonly OrderStatus[]) =>
    steps.reduce((order, status) => transitionOrder(order, status, clock), draft());
  const TO_AWAITING: readonly OrderStatus[] = [
    ORDER_STATUS.RISK_CHECK,
    ORDER_STATUS.RESERVED,
    ORDER_STATUS.AWAITING_PAYMENT,
  ];

  it.each<[string, readonly OrderStatus[]]>([
    ['odeme bekleyen', TO_AWAITING],
    ['odenmis (sistemin telafisi)', [...TO_AWAITING, ORDER_STATUS.PAID]],
  ])(
    '%s siparis iptal edilince: status_changed ve ardindan iptal komutu, ayni surum ve an',
    (_name, steps) => {
      const before = walk(steps);
      const after = transitionOrder(before, ORDER_STATUS.CANCELLED, clock, 'USER_CANCELLED');

      const events = statusChangedEvents(before, after);

      expect(events.map((event) => event.topic)).toEqual([
        EVENTS.ORDER_STATUS_CHANGED,
        EVENTS.PAYMENT_CANCEL_REQUESTED,
      ]);
      const [changed, command] = events;
      expect(command).toMatchObject({
        orderId: after.id,
        version: changed?.version,
        occurredAt: changed?.occurredAt,
        payload: { orderId: after.id, reason: 'order_cancelled' },
      });
      expect(isId(ID_PREFIX.EVENT, command?.eventId)).toBe(true);
      // payment ayni semayla dogrular: govde sozlesmeden gecer.
      expect(paymentCancelRequestedPayloadSchema.safeParse(command?.payload).success).toBe(true);
    },
  );

  it.each<[string, readonly OrderStatus[], OrderStatus]>([
    ['taslak iptali (odeme olamaz)', [], ORDER_STATUS.CANCELLED],
    ['risk incelemesi', [ORDER_STATUS.RISK_CHECK], ORDER_STATUS.REVIEW],
    ['odeme', TO_AWAITING, ORDER_STATUS.PAID],
    ['odeme hatasi', TO_AWAITING, ORDER_STATUS.PAYMENT_FAILED],
  ])('%s: iptal komutu YOK', (_name, steps, to) => {
    const before = walk(steps);
    const after = transitionOrder(before, to, clock);

    expect(statusChangedEvents(before, after).map((event) => event.topic)).toEqual([
      EVENTS.ORDER_STATUS_CHANGED,
    ]);
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

  it('saga nin gercek gerekce ve anahtariyla kurulan govde sozlesmeden gecer (payment ayni semayla dogrular, T7.4)', () => {
    const order = draft();

    const event = refundRequestedEvent(
      order,
      {
        reason: REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT,
        idempotencyKey: refundIdempotencyKey(order.id),
      },
      new Date(T0),
    );

    expect(refundRequestedPayloadSchema.safeParse(event.payload).success).toBe(true);
  });
});
