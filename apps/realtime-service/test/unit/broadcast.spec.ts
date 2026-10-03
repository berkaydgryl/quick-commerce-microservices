import { recordingLogger } from '@getir/core/testing';
import type { LogLine } from '@getir/core/testing';
import { describe, expect, it } from 'vitest';

import { createBroadcast, DROP_REASON } from '../../src/application/broadcast.js';
import type { ServerEventName } from '../../src/application/broadcast.js';
import { MARKET_ID, ORDER_ID, ORDER_ROOM, OTHER_ORDER_ID, STORE_ROOM } from '../support/tokens.js';

const AT = '2026-10-03T12:00:00.000Z';

function setup() {
  const emitted: { room: string; event: ServerEventName; payload: unknown }[] = [];
  const counts = { emitted: [] as ServerEventName[], dropped: [] as ServerEventName[] };
  const lines: LogLine[] = [];
  const broadcast = createBroadcast({
    emitter: {
      emit: (room, event, payload) => {
        emitted.push({ room, event, payload });
      },
    },
    metrics: {
      eventEmitted: (event) => {
        counts.emitted.push(event);
      },
      eventDropped: (event) => {
        counts.dropped.push(event);
      },
    },
    logger: recordingLogger(lines),
  });
  return { broadcast, emitted, counts, lines };
}

const orderStatus = {
  orderId: ORDER_ID,
  status: 'PAID',
  previousStatus: 'AWAITING_PAYMENT',
  at: AT,
  seq: 1,
};
const stockChanged = { marketId: MARKET_ID, productId: 'prd_sut-1l', availableQuantity: 4, at: AT };

describe('createBroadcast', () => {
  it('siparis olayini kendi odasina yayinlar ve sayar', () => {
    const { broadcast, emitted, counts } = setup();

    expect(broadcast(ORDER_ROOM, 'order.status', orderStatus)).toBe(true);

    expect(emitted).toEqual([{ room: ORDER_ROOM, event: 'order.status', payload: orderStatus }]);
    expect(counts.emitted).toEqual(['order.status']);
  });

  it('stock.changed market odasina gider; semada olmayan alan (sku) sizmaz', () => {
    const { broadcast, emitted } = setup();

    expect(broadcast(STORE_ROOM, 'stock.changed', { ...stockChanged, sku: 'SUT-1L' })).toBe(true);

    expect(emitted[0]?.payload).toEqual(stockChanged);
  });

  it.each([
    [
      'gecersiz govde',
      ORDER_ROOM,
      'order.status',
      { ...orderStatus, seq: 0 },
      DROP_REASON.INVALID_PAYLOAD,
    ],
    ['bicim disi oda', 'order:1', 'order.status', orderStatus, DROP_REASON.INVALID_ROOM],
    [
      'siparis olayi market odasina',
      STORE_ROOM,
      'order.status',
      orderStatus,
      DROP_REASON.WRONG_ROOM_KIND,
    ],
    [
      'stok olayi siparis odasina',
      ORDER_ROOM,
      'stock.changed',
      stockChanged,
      DROP_REASON.WRONG_ROOM_KIND,
    ],
    [
      'baska siparisin olayi',
      ORDER_ROOM,
      'order.status',
      { ...orderStatus, orderId: OTHER_ORDER_ID },
      DROP_REASON.ROOM_MISMATCH,
    ],
    [
      'baska marketin stogu',
      STORE_ROOM,
      'stock.changed',
      { ...stockChanged, marketId: 'mkt_baska-market' },
      DROP_REASON.ROOM_MISMATCH,
    ],
  ] as const)(
    '%s yayinlanmaz, sayilir ve govdesiz loglanir',
    (_name, room, event, payload, reason) => {
      const { broadcast, emitted, counts, lines } = setup();

      expect(broadcast(room, event, payload)).toBe(false);

      expect(emitted).toEqual([]);
      expect(counts.dropped).toEqual([event]);
      expect(lines).toEqual([
        {
          level: 'error',
          fields: { event, reason },
          message: 'olay sozlesmeye uymuyor, yayinlanmadi',
        },
      ]);
    },
  );
});
