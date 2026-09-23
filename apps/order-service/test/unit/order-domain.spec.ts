import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { createDraftOrder, TIMELINE_NOTE, transitionOrder } from '../../src/domain/order.js';
import type { DraftOrderInput } from '../../src/domain/order.js';

const CLOCK_EPOCH_MS = 1_760_000_000_000;
const clock = fixedClock(CLOCK_EPOCH_MS);

const input: DraftOrderInput = {
  userId: 'usr_1',
  marketId: 'mkt_migros-jet-moda',
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 2 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy, İstanbul',
};

describe('createDraftOrder', () => {
  it('onekli kimlik uretir ve DRAFT durumunda acar', () => {
    const order = createDraftOrder(input, clock);

    expect(order.id).toMatch(/^ord_[0-9a-f]{32}$/);
    expect(order.status).toBe(ORDER_STATUS.DRAFT);
  });

  it('zaman cizelgesi DRAFT kaydiyla baslar; zaman Clock tan', () => {
    const order = createDraftOrder(input, clock);

    expect(order.timeline).toEqual([{ status: ORDER_STATUS.DRAFT, at: new Date(CLOCK_EPOCH_MS) }]);
    expect(order.createdAt.getTime()).toBe(CLOCK_EPOCH_MS);
  });

  it('her cagride farkli kimlik uretir', () => {
    const ids = new Set([createDraftOrder(input, clock).id, createDraftOrder(input, clock).id]);

    expect(ids.size).toBe(2);
  });
});

describe('transitionOrder', () => {
  it('durumu degistirir, timeline a EKLER, girdiyi degistirmez', () => {
    const draft = createDraftOrder(input, clock);
    const later = fixedClock(CLOCK_EPOCH_MS + 5_000);

    const next = transitionOrder(
      draft,
      ORDER_STATUS.RISK_CHECK,
      later,
      TIMELINE_NOTE.PENDING_RISK_SERVICE,
    );

    expect(draft.status).toBe(ORDER_STATUS.DRAFT);
    expect(draft.timeline).toHaveLength(1);
    expect(next.status).toBe(ORDER_STATUS.RISK_CHECK);
    expect(next.timeline).toEqual([
      { status: ORDER_STATUS.DRAFT, at: new Date(CLOCK_EPOCH_MS) },
      {
        status: ORDER_STATUS.RISK_CHECK,
        at: new Date(CLOCK_EPOCH_MS + 5_000),
        note: 'PENDING_RISK_SERVICE',
      },
    ]);
    expect(next.updatedAt.getTime()).toBe(CLOCK_EPOCH_MS + 5_000);
    expect(next.createdAt.getTime()).toBe(CLOCK_EPOCH_MS);
  });

  it('not verilmezse kayitta note alani HIC olmaz', () => {
    const next = transitionOrder(createDraftOrder(input, clock), ORDER_STATUS.RISK_CHECK, clock);

    expect(Object.hasOwn(next.timeline[1] ?? {}, 'note')).toBe(false);
  });

  it('tablo disi gecis ORDER_STATE_INVALID; siparis degismez', () => {
    const draft = createDraftOrder(input, clock);

    expect(() => transitionOrder(draft, ORDER_STATUS.PAID, clock)).toThrow(AppError);
    expect(() => transitionOrder(draft, ORDER_STATUS.PAID, clock)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.ORDER_STATE_INVALID }) as Error,
    );
    expect(draft.status).toBe(ORDER_STATUS.DRAFT);
  });
});
