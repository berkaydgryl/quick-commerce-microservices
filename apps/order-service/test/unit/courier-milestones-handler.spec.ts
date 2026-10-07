/**
 * Kurye kilometre tasi tuketicileri (T14.3): courier.picked_up ve
 * courier.delivered -> RecordCourierMilestone. Bellek deposu; Redis yok (olay
 * hattinin kendisi @getir/event-bus testlerinde, uctan uca yol
 * test/integration/courier-milestones-consumer.spec.ts).
 */

import { ERROR_CODES, EVENTS, fixedClock, ID_PREFIX, newId, ORDER_STATUS } from '@getir/core';
import type { EventName } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import type { EventEnvelope, EventHandler, EventSubscriber } from '@getir/event-bus';
import { beforeEach, describe, expect, it } from 'vitest';

import { subscribeOrderEvents } from '../../src/bootstrap.js';
import { EVENT_CONSUMER_GROUP } from '../../src/config/constants.js';
import { transitionOrder } from '../../src/domain/order.js';
import { InMemoryOrderStore } from '../../src/infrastructure/memory/in-memory-order-store.js';
import {
  deliveredEvent,
  insertWithCourier,
  newCourierId,
  pickedUpEvent,
} from '../support/courier-milestone-fixtures.js';
import { insertPaid } from '../support/order-builders.js';

const clock = fixedClock(Date.UTC(2026, 9, 7, 22, 0));
const S = ORDER_STATUS;

let store: InMemoryOrderStore;
let lines: LogLine[];
let handlers: Map<EventName, EventHandler>;
let groups: Set<string>;

beforeEach(() => {
  store = new InMemoryOrderStore();
  lines = [];
  handlers = new Map();
  groups = new Set();
  const subscriber: EventSubscriber = {
    subscribe: (topic, group, handler) => {
      handlers.set(topic, handler);
      groups.add(group);
    },
  };
  subscribeOrderEvents(subscriber, { repository: store, clock });
});

function deliver(envelope: EventEnvelope) {
  const handler = handlers.get(envelope.topic);
  if (handler === undefined) {
    throw new Error(`isleyici yok: ${envelope.topic}`);
  }
  return handler(envelope, { attempt: 1, logger: recordingLogger(lines) });
}

describe('kayit', () => {
  it('iki konu, grup servis adi (order)', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [EVENTS.COURIER_DELIVERED, EVENTS.COURIER_PICKED_UP].sort(),
    );
    expect([...groups]).toEqual([EVENT_CONSUMER_GROUP]);
    expect(EVENT_CONSUMER_GROUP).toBe('order');
  });
});

describe('islenir (onaylanir)', () => {
  it('paket alindi: siparis yolda; INFO yalnizca kimlik ve durum', async () => {
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);

    const outcome = await deliver(pickedUpEvent(order, courierId, clock.date()));

    expect(outcome).toEqual({ kind: 'handled' });
    expect((await store.findById(order.id))?.status).toBe(S.ON_THE_WAY);
    expect(lines).toEqual([
      {
        level: 'info',
        message: 'kurye kilometre tasi: siparis ilerledi',
        fields: {
          orderId: order.id,
          courierId,
          milestone: 'PICKED_UP',
          from: S.PREPARING,
          to: S.ON_THE_WAY,
        },
      },
    ]);
  });

  it('teslim edildi: siparis kapanir (DELIVERED)', async () => {
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);

    await deliver(pickedUpEvent(order, courierId, clock.date()));
    const outcome = await deliver(deliveredEvent(order, courierId, clock.date()));

    expect(outcome).toEqual({ kind: 'handled' });
    expect((await store.findById(order.id))?.status).toBe(S.DELIVERED);
  });

  it('tekrar DEBUG, eski olay WARN, kapanmis siparis INFO; hepsi onaylanir, yazim yok', async () => {
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);
    await deliver(pickedUpEvent(order, courierId, clock.date()));
    const paid = await insertPaid(store, clock);
    const cancelled = transitionOrder(paid, S.CANCELLED, clock);
    await store.update(cancelled, paid.version, []);
    lines.length = 0;

    const outcomes = [
      await deliver(pickedUpEvent(order, courierId, clock.date())),
      await deliver(deliveredEvent(order, newCourierId(), clock.date())),
      await deliver(deliveredEvent(cancelled, courierId, clock.date())),
    ];

    expect(outcomes).toEqual([{ kind: 'handled' }, { kind: 'handled' }, { kind: 'handled' }]);
    expect(lines.map((line) => line.level)).toEqual(['debug', 'warn', 'info']);
    expect((await store.findById(order.id))?.status).toBe(S.ON_THE_WAY);
    expect((await store.findById(cancelled.id))?.status).toBe(S.CANCELLED);
  });

  it('yukteki fazla alan (konum) gunluge girmez', async () => {
    const courierId = newCourierId();
    const order = await insertWithCourier(store, clock, courierId);
    const location = { lat: 40.98765, lng: 29.12345 };

    await deliver(pickedUpEvent(order, courierId, clock.date(), { location }));

    expect(JSON.stringify(lines)).not.toMatch(/location|40\.98765|29\.12345/);
  });
});

describe('reddedilir (olu olaylara)', () => {
  it('bozuk govde: hangi alanin uymadigi gerekcede', async () => {
    const order = await insertWithCourier(store, clock, newCourierId());

    const outcome = await deliver(
      pickedUpEvent(order, newCourierId(), clock.date(), { courierId: 'kurye-1' }),
    );

    expect(outcome).toMatchObject({ kind: 'rejected' });
    expect(outcome.kind === 'rejected' ? outcome.reason : '').toContain('courierId');
  });

  it('siparis yok', async () => {
    const order = { id: newId(ID_PREFIX.ORDER) };

    const outcome = await deliver(deliveredEvent(order, newCourierId(), clock.date()));

    expect(outcome).toEqual({ kind: 'rejected', reason: 'kurye olayinin siparisi yok' });
  });
});

describe('yeniden teslim edilir (firlatir)', () => {
  it('kurye henuz yazilmamis (PAID): ORDER_STATE_INVALID, siparis degismez', async () => {
    const paid = await insertPaid(store, clock);

    await expect(deliver(pickedUpEvent(paid, newCourierId(), clock.date()))).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_STATE_INVALID,
      details: { orderId: paid.id, status: S.PAID },
    });
    expect((await store.findById(paid.id))?.status).toBe(S.PAID);
  });
});
