/**
 * Kurye atama kurallari (T13.1 PR 2, domain/courier-dispatch.ts): saf, sabit saat.
 * T13.2: kurye kuyrugunun sirasi (#92).
 */

import { AppError, ERROR_CODES, fixedClock, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  compareCourierQueue,
  courierQueue,
  courierQueueTime,
  isCourierDue,
  isWaitingForCourier,
  latestQueueTime,
  needsCourier,
  queuedForCourier,
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

/** `atMs`'de odenmis siparis, odeme adimi gibi kuyruga yazilmis. */
const paidAt = (atMs: number): Order => {
  const draft = createDraftOrder(sampleDraftInput(), fixedClock(atMs));
  return queuedForCourier(
    TO_PAID.reduce<Order>(
      (order, status) => transitionOrder(order, status, fixedClock(atMs)),
      draft,
    ),
  );
};

describe('kurye kuyrugu (#92)', () => {
  it('queuedForCourier: kuyruk ani PAID gecisinin ani; baska alan degismez', () => {
    const before = orderIn(TO_PAID);

    const after = queuedForCourier(before);

    expect(after).toEqual({ ...before, courierQueuedAt: new Date(PAID_AT) });
  });

  it('courierQueueTime: alan; yoksa zaman cizelgesindeki odeme ani; o da yoksa olusturma ani', () => {
    expect(courierQueueTime({ ...paid(), courierQueuedAt: new Date(7) })).toEqual(new Date(7));
    const paidLater = transitionOrder(
      orderIn(TO_PAID.slice(0, 3)),
      ORDER_STATUS.PAID,
      fixedClock(PAID_AT + 9_000),
    );
    expect(courierQueueTime(paidLater)).toEqual(new Date(PAID_AT + 9_000));
    expect(courierQueueTime(orderIn([]))).toEqual(new Date(PAID_AT));
  });

  it('kurye yok: kuyruk ani korunur; alan oncesi kayitta odeme anindan yazilir. Kurye ataninca silinir', () => {
    const queued = paidAt(PAID_AT - 60_000);
    expect(withCourierRetry(queued, new Date(NOW), clock).courierQueuedAt).toEqual(
      new Date(PAID_AT - 60_000),
    );
    expect(withCourierRetry(paid(), new Date(NOW), clock).courierQueuedAt).toEqual(
      new Date(PAID_AT),
    );

    const assigned = withAssignedCourier(
      withCourierRetry(queued, new Date(NOW), clock),
      'crr_1',
      clock,
    );
    expect(assigned).not.toHaveProperty('courierQueuedAt');
    expect(withAssignedCourier(queued, 'crr_1', clock)).not.toHaveProperty('courierQueuedAt');
  });

  it('isWaitingForCourier: yalnizca iscinin "kurye yok" yazdigi kuryesiz PREPARING (deneme ani gelmemis olsa da)', () => {
    expect(isWaitingForCourier(waiting(NOW + 60_000))).toBe(true);
    expect(isWaitingForCourier(waiting(NOW))).toBe(true);
    expect(isWaitingForCourier(paid())).toBe(false);
    expect(isWaitingForCourier(withAssignedCourier(paid(), 'crr_1', clock))).toBe(false);
    expect(isWaitingForCourier(orderIn([...TO_PAID, ORDER_STATUS.PREPARING]))).toBe(false);
    expect(isWaitingForCourier(orderIn([...TO_PAID, ORDER_STATUS.CANCELLED]))).toBe(false);
  });

  it('sira: once odeyen once; esitlikte kimlik', () => {
    const early = paidAt(PAID_AT);
    const late = paidAt(PAID_AT + 1);
    const tieA = { ...paidAt(PAID_AT + 5), id: 'ord_a' };
    const tieB = { ...paidAt(PAID_AT + 5), id: 'ord_b' };

    expect([late, tieB, early, tieA].sort(compareCourierQueue)).toEqual([early, late, tieA, tieB]);
    expect(compareCourierQueue(early, early)).toBe(0);
  });

  it('courierQueue: talep yoksa bos; varsa talep ve bekleyenler tekrarsiz, odeme sirasiyla', () => {
    const w1 = withCourierRetry(paidAt(PAID_AT), new Date(NOW + 60_000), clock);
    const w2 = withCourierRetry(paidAt(PAID_AT + 1_000), new Date(NOW - 1), clock);
    const fresh = paidAt(PAID_AT + 3_000);

    expect(courierQueue([], [w1, w2])).toEqual([]);
    expect(courierQueue([fresh, w2], [w2, w1]).map((order) => order.id)).toEqual([
      w1.id,
      w2.id,
      fresh.id,
    ]);
  });

  it('latestQueueTime: talebin en gec odeme ani; talep yoksa yok', () => {
    expect(latestQueueTime([])).toBeUndefined();
    expect(
      latestQueueTime([paidAt(PAID_AT + 3_000), paidAt(PAID_AT), paidAt(PAID_AT + 1_000)]),
    ).toEqual(new Date(PAID_AT + 3_000));
  });
});
