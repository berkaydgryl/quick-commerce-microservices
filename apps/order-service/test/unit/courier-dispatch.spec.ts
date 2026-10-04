/**
 * Kurye atama kurallari (T13.1 PR 2, domain/courier-dispatch.ts): saf, sabit saat.
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  isCourierDue,
  needsCourier,
  releasesCourier,
  withAssignedCourier,
  withCourierRetry,
} from '../../src/domain/courier-dispatch.js';
import { statusChangedEvents } from '../../src/domain/order-events.js';
import type { Order } from '../../src/domain/order.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import { sampleDraftInput } from '../support/order-builders.js';

const PAID_AT = 1_760_000_000_000;
const NOW = PAID_AT + 5_000;
const clock = fixedClock(NOW);

const TO_PAID: readonly OrderStatus[] = [
  ORDER_STATUS.RISK_CHECK,
  ORDER_STATUS.RESERVED,
  ORDER_STATUS.AWAITING_PAYMENT,
  ORDER_STATUS.PAID,
];

function orderIn(steps: readonly OrderStatus[]): Order {
  const draft = createDraftOrder(sampleDraftInput(), fixedClock(PAID_AT));
  return steps.reduce<Order>(
    (order, status) => transitionOrder(order, status, fixedClock(PAID_AT)),
    draft,
  );
}

/** Firlatilan AppError'in kodu; firlatmazsa test duser. */
function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  return expect.unreachable('AppError beklenirdi');
}

const paid = (): Order => orderIn(TO_PAID);
/** Kuryesiz PREPARING: ilk denemede kurye yoktu, `retryAtMs`'de yeniden. */
const waiting = (retryAtMs: number): Order =>
  withCourierRetry(paid(), new Date(retryAtMs), fixedClock(PAID_AT));

describe('isCourierDue / needsCourier', () => {
  it('odenmis siparis hemen kurye ister', () => {
    expect(isCourierDue(paid(), new Date(NOW))).toBe(true);
    expect(needsCourier(paid())).toBe(true);
  });

  it('kuryesiz PREPARING deneme ani gelince (an dahil) ister, once istemez', () => {
    expect(isCourierDue(waiting(NOW), new Date(NOW))).toBe(true);
    expect(isCourierDue(waiting(NOW + 1), new Date(NOW))).toBe(false);
    expect(needsCourier(waiting(NOW + 1))).toBe(true);
  });

  it('kuryeli PREPARING, deneme ani olmayan eski PREPARING ve diger durumlar istemez', () => {
    const assigned = withAssignedCourier(paid(), 'crr_1', clock);
    const legacy = transitionOrder(paid(), ORDER_STATUS.PREPARING, clock);
    const others = [
      orderIn([]),
      orderIn(TO_PAID.slice(0, 3)),
      orderIn([...TO_PAID, ORDER_STATUS.CANCELLED]),
    ];

    expect(isCourierDue(assigned, new Date(NOW))).toBe(false);
    expect(needsCourier(assigned)).toBe(false);
    expect(isCourierDue(legacy, new Date(NOW))).toBe(false);
    for (const order of others) {
      expect(isCourierDue(order, new Date(NOW))).toBe(false);
      expect(needsCourier(order)).toBe(false);
    }
  });
});

describe('withAssignedCourier', () => {
  it('PAID -> PREPARING kuryeyle: tek gecis, zaman cizelgesi, surum +1, tek olay', () => {
    const before = paid();

    const after = withAssignedCourier(before, 'crr_1', clock);

    expect(after).toMatchObject({
      status: ORDER_STATUS.PREPARING,
      courier: { courierId: 'crr_1', assignedAt: new Date(NOW) },
      updatedAt: new Date(NOW),
      version: before.version + 1,
    });
    expect(after).not.toHaveProperty('courierRetryAt');
    expect(after.timeline.at(-1)).toEqual({ status: ORDER_STATUS.PREPARING, at: new Date(NOW) });
    const events = statusChangedEvents(before, after);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ from: 'PAID', to: 'PREPARING' });
  });

  it('kuryesiz PREPARING: kurye yazilir, deneme ani silinir, surum +1; gecis ve olay YOK', () => {
    const before = waiting(NOW - 1);

    const after = withAssignedCourier(before, 'crr_2', clock);

    expect(after).toMatchObject({
      status: ORDER_STATUS.PREPARING,
      courier: { courierId: 'crr_2', assignedAt: new Date(NOW) },
      version: before.version + 1,
    });
    expect(after).not.toHaveProperty('courierRetryAt');
    expect(after.timeline).toEqual(before.timeline);
    expect(statusChangedEvents(before, after)).toEqual([]);
  });

  it('kurye beklemeyen siparise kurye de deneme ani da yazilamaz: ORDER_STATE_INVALID', () => {
    const assigned = withAssignedCourier(paid(), 'crr_1', clock);

    for (const order of [assigned, orderIn([])]) {
      expect(codeOf(() => withAssignedCourier(order, 'crr_9', clock))).toBe(
        ERROR_CODES.ORDER_STATE_INVALID,
      );
      expect(codeOf(() => withCourierRetry(order, new Date(NOW), clock))).toBe(
        ERROR_CODES.ORDER_STATE_INVALID,
      );
    }
  });
});

describe('withCourierRetry', () => {
  it('PAID -> PREPARING kuryesiz: deneme ani yazilir, olay PAID -> PREPARING', () => {
    const before = paid();
    const retryAt = new Date(NOW + 30_000);

    const after = withCourierRetry(before, retryAt, clock);

    expect(after).toMatchObject({
      status: ORDER_STATUS.PREPARING,
      courierRetryAt: retryAt,
      version: before.version + 1,
    });
    expect(after).not.toHaveProperty('courier');
    expect(statusChangedEvents(before, after)).toHaveLength(1);
  });

  it('kuryesiz PREPARING yeniden: yeni deneme ani, surum +1, olay YOK', () => {
    const before = waiting(NOW);
    const retryAt = new Date(NOW + 30_000);

    const after = withCourierRetry(before, retryAt, clock);

    expect(after).toMatchObject({ courierRetryAt: retryAt, version: before.version + 1 });
    expect(after.timeline).toEqual(before.timeline);
    expect(statusChangedEvents(before, after)).toEqual([]);
  });
});

describe('releasesCourier (QA T3)', () => {
  it('son durumdaki (iptal) siparis kuryeyi birakir; kurye bekleyen ya da tasiyan birakmaz', () => {
    expect(releasesCourier(orderIn([...TO_PAID, ORDER_STATUS.CANCELLED]))).toBe(true);
    expect(releasesCourier(paid())).toBe(false);
    expect(releasesCourier(waiting(NOW))).toBe(false);
    expect(releasesCourier(withAssignedCourier(paid(), 'crr_1', clock))).toBe(false);
  });
});
