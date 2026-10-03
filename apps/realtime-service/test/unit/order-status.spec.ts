/**
 * T12.3: siparis durum degisimi -> order.status. Saf kural (seq), ceviri,
 * use-case (sahte surum deposu ve yayin kapisi) ve olay isleyicisi.
 */

import type { OrderStatusChangedPayload } from '@getir/contracts';
import { ID_PREFIX, newId } from '@getir/core';
import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import type { EventEnvelope } from '@getir/event-bus';
import { describe, expect, it } from 'vitest';

import type { Broadcast, ServerEventName } from '../../src/application/broadcast.js';
import {
  createPublishOrderStatus,
  PUBLISH_OUTCOME,
} from '../../src/application/publish-order-status.js';
import type { SeqStore } from '../../src/application/seq-store.js';
import { toOrderStatusEvent } from '../../src/domain/order-status-event.js';
import { decideSeq, SEQ_DECISION } from '../../src/domain/seq.js';
import { createOrderStatusChangedHandler } from '../../src/interfaces/workers/order-status-changed.js';
import { ORDER_ID, ORDER_ROOM, USER_ID } from '../support/tokens.js';

const AT = '2026-10-03T12:00:00.000Z';

const changed = (
  overrides: Partial<OrderStatusChangedPayload> = {},
): OrderStatusChangedPayload => ({
  orderId: ORDER_ID,
  userId: USER_ID,
  marketId: 'mkt_migros-jet-moda',
  from: 'AWAITING_PAYMENT',
  to: 'PAID',
  version: 5,
  ...overrides,
});

/** Bellekte surum deposu: Redis uygulamasiyla ayni sozlesme (yalnizca buyukse yazar). */
function memorySeqStore(
  initial: Record<string, number> = {},
): SeqStore & { values: Record<string, number> } {
  const values = { ...initial };
  return {
    values,
    recordIfNewer: (orderId, seq) => {
      const previous = values[orderId];
      if (previous === undefined || seq > previous) {
        values[orderId] = seq;
      }
      return Promise.resolve(previous);
    },
  };
}

function recordingBroadcast(accept = true): Broadcast & {
  calls: { room: string; event: ServerEventName; payload: unknown }[];
} {
  const calls: { room: string; event: ServerEventName; payload: unknown }[] = [];
  const broadcast = (room: string, event: ServerEventName, payload: unknown): boolean => {
    calls.push({ room, event, payload });
    return accept;
  };
  return Object.assign(broadcast, { calls });
}

function setup(options: { initial?: Record<string, number>; accept?: boolean } = {}) {
  const seqStore = memorySeqStore(options.initial);
  const broadcast = recordingBroadcast(options.accept ?? true);
  const stale: string[] = [];
  const publish = createPublishOrderStatus({
    seqStore,
    broadcast,
    metrics: {
      eventStale: (event) => {
        stale.push(event);
      },
    },
  });
  return { publish, seqStore, broadcast, stale };
}

describe('decideSeq (K4)', () => {
  it.each([
    [undefined, 1, SEQ_DECISION.NEWER],
    [4, 5, SEQ_DECISION.NEWER],
    [5, 5, SEQ_DECISION.SAME],
    [6, 5, SEQ_DECISION.STALE],
  ])('onceki %s, gelen %s -> %s', (previous, seq, decision) => {
    expect(decideSeq(previous, seq)).toBe(decision);
  });
});

describe('toOrderStatusEvent', () => {
  it('to/from/version -> status/previousStatus/seq; an zarfin occurredAt i', () => {
    expect(toOrderStatusEvent(changed(), AT)).toEqual({
      orderId: ORDER_ID,
      status: 'PAID',
      previousStatus: 'AWAITING_PAYMENT',
      at: AT,
      seq: 5,
    });
  });

  it('ilk geciste previousStatus yok; ic alanlar (userId, not) cikmaz', () => {
    const { from: _from, ...first } = changed({
      to: 'RISK_CHECK',
      version: 2,
      note: 'CART_RELEASED',
    });

    const event = toOrderStatusEvent(first, AT);

    expect(event).toEqual({ orderId: ORDER_ID, status: 'RISK_CHECK', at: AT, seq: 2 });
    expect(JSON.stringify(event)).not.toContain(USER_ID);
    expect(JSON.stringify(event)).not.toContain('CART_RELEASED');
  });
});

describe('createPublishOrderStatus', () => {
  it('yeni surum: once kaydedilir, sonra siparis odasina order.status yayinlanir', async () => {
    const { publish, seqStore, broadcast } = setup({ initial: { [ORDER_ID]: 4 } });

    const result = await publish({ payload: changed(), occurredAt: AT });

    expect(result).toEqual({ outcome: PUBLISH_OUTCOME.PUBLISHED, decision: SEQ_DECISION.NEWER });
    expect(seqStore.values[ORDER_ID]).toBe(5);
    expect(broadcast.calls).toEqual([
      {
        room: ORDER_ROOM,
        event: 'order.status',
        payload: {
          orderId: ORDER_ID,
          status: 'PAID',
          previousStatus: 'AWAITING_PAYMENT',
          at: AT,
          seq: 5,
        },
      },
    ]);
  });

  it('ayni surum yeniden gelirse yeniden yayinlanir (en az bir kez, D2)', async () => {
    const { publish, broadcast } = setup({ initial: { [ORDER_ID]: 5 } });

    const result = await publish({ payload: changed(), occurredAt: AT });

    expect(result.outcome).toBe(PUBLISH_OUTCOME.REPUBLISHED);
    expect(broadcast.calls).toHaveLength(1);
  });

  it('eski surum yayinlanmaz, kayit degismez, sayilir', async () => {
    const { publish, seqStore, broadcast, stale } = setup({ initial: { [ORDER_ID]: 7 } });

    const result = await publish({ payload: changed(), occurredAt: AT });

    expect(result).toEqual({ outcome: PUBLISH_OUTCOME.STALE, decision: SEQ_DECISION.STALE });
    expect(broadcast.calls).toEqual([]);
    expect(seqStore.values[ORDER_ID]).toBe(7);
    expect(stale).toEqual(['order.status']);
  });

  it('sirasiz gelen surumlerden yalnizca artanlar yayinlanir', async () => {
    const { publish, broadcast } = setup();

    for (const version of [3, 2, 4, 4, 1]) {
      await publish({ payload: changed({ version }), occurredAt: AT });
    }

    expect(broadcast.calls.map((call) => (call.payload as { seq: number }).seq)).toEqual([3, 4, 4]);
  });

  it('yayin kapisi olayi atarsa sonuc dropped', async () => {
    const { publish } = setup({ accept: false });

    await expect(publish({ payload: changed(), occurredAt: AT })).resolves.toMatchObject({
      outcome: PUBLISH_OUTCOME.DROPPED,
    });
  });

  it('surum deposu hata verirse hata yukari cikar (olay yeniden teslim edilsin)', async () => {
    const broadcast = recordingBroadcast();
    const publish = createPublishOrderStatus({
      seqStore: { recordIfNewer: () => Promise.reject(new Error('redis kapali')) },
      broadcast,
      metrics: { eventStale: () => undefined },
    });

    await expect(publish({ payload: changed(), occurredAt: AT })).rejects.toThrow('redis kapali');
    expect(broadcast.calls).toEqual([]);
  });
});

describe('createOrderStatusChangedHandler', () => {
  const envelope = (payload: Record<string, unknown>): EventEnvelope => ({
    eventId: newId(ID_PREFIX.EVENT),
    topic: 'order.status_changed',
    partitionKey: ORDER_ID,
    occurredAt: AT,
    payload,
  });

  it('gecerli govde yayinlanir, islendi sayilir ve sonuc gunluge yazilir', async () => {
    const { publish, broadcast } = setup();
    const lines: LogLine[] = [];
    const handler = createOrderStatusChangedHandler({ publish });

    const outcome = await handler(envelope({ ...changed() }), {
      attempt: 1,
      logger: recordingLogger(lines),
    });

    expect(outcome).toEqual({ kind: 'handled' });
    expect(broadcast.calls).toHaveLength(1);
    expect(lines).toEqual([
      {
        level: 'info',
        message: 'siparis durumu odaya yayinlandi',
        fields: { orderId: ORDER_ID, status: 'PAID', seq: 5, outcome: 'published' },
      },
    ]);
  });

  it.each([
    ['surum yok', { version: undefined }],
    ['bilinmeyen durum', { to: 'SHIPPED' }],
    ['siparis kimligi degil', { orderId: 'ord_1' }],
  ])('sozlesme disi govde (%s) reddedilir; yayin yok (D8)', async (_name, patch) => {
    const { publish, broadcast } = setup();
    const handler = createOrderStatusChangedHandler({ publish });

    const outcome = await handler(envelope({ ...changed(), ...patch }), {
      attempt: 1,
      logger: recordingLogger([]),
    });

    expect(outcome).toMatchObject({ kind: 'rejected' });
    expect(broadcast.calls).toEqual([]);
  });
});
