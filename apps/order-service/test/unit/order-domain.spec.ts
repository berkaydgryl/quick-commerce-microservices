import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { assertCanStartPayment, createDraftOrder, withStatus } from '../../src/domain/order.js';
import type { DraftOrderInput } from '../../src/domain/order.js';

const CLOCK_EPOCH_MS = 1_760_000_000_000;
const clock = fixedClock(CLOCK_EPOCH_MS);

const input: DraftOrderInput = {
  userId: 'usr_1',
  darkStoreId: 'ds_kadikoy',
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

  it('zamani Clock uzerinden okur (Date.now cagrilmaz)', () => {
    const order = createDraftOrder(input, clock);

    expect(order.createdAt.getTime()).toBe(CLOCK_EPOCH_MS);
    expect(order.updatedAt.getTime()).toBe(CLOCK_EPOCH_MS);
  });

  it('her cagride farkli kimlik uretir', () => {
    const ids = new Set([createDraftOrder(input, clock).id, createDraftOrder(input, clock).id]);

    expect(ids.size).toBe(2);
  });
});

describe('assertCanStartPayment', () => {
  it('DRAFT siparise izin verir', () => {
    expect(() => assertCanStartPayment(createDraftOrder(input, clock))).not.toThrow();
  });

  it('baska durumda ORDER_STATE_INVALID firlatir', () => {
    // "Tabloda olmayan gecis hata firlatir" kurali (sozlesme yorumu).
    const paid = withStatus(createDraftOrder(input, clock), ORDER_STATUS.PAID, clock);

    try {
      assertCanStartPayment(paid);
      expect.unreachable('PAID siparis odemeye gecememeliydi');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ERROR_CODES.ORDER_STATE_INVALID);
    }
  });
});

describe('withStatus', () => {
  it('yeni nesne dondurur, girdiyi degistirmez', () => {
    const draft = createDraftOrder(input, clock);
    const later = fixedClock(CLOCK_EPOCH_MS + 5_000);

    const updated = withStatus(draft, ORDER_STATUS.AWAITING_PAYMENT, later);

    expect(draft.status).toBe(ORDER_STATUS.DRAFT);
    expect(updated.status).toBe(ORDER_STATUS.AWAITING_PAYMENT);
    expect(updated.updatedAt.getTime()).toBe(CLOCK_EPOCH_MS + 5_000);
    expect(updated.createdAt.getTime()).toBe(CLOCK_EPOCH_MS);
  });
});
