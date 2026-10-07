/**
 * Gecmis Siparislerim'de gorunurluk kurali (#101, domain/order-history-listing.ts):
 * her durum x zaman cizelgesinde odeme var mi tablosu ve gercek gecis yollari.
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { isListedInHistory } from '../../src/domain/order-history-listing.js';
import type { Order, TimelineEntry } from '../../src/domain/order.js';
import { createDraftOrder, transitionOrder } from '../../src/domain/order.js';
import { sampleDraftInput } from '../support/order-builders.js';

const S = ORDER_STATUS;
const AT = new Date('2026-10-07T10:00:00.000Z');
const clock = fixedClock(AT.getTime());

/** Durum basina beklenen: [odeme kaydi yok, odeme kaydi var]. Her durum yazili. */
const EXPECTED: Readonly<Record<OrderStatus, readonly [boolean, boolean]>> = {
  [S.DRAFT]: [false, false],
  [S.RISK_CHECK]: [false, false],
  [S.REVIEW]: [true, true],
  [S.RESERVED]: [false, false],
  [S.AWAITING_PAYMENT]: [false, false],
  [S.PAID]: [true, true],
  [S.PAYMENT_FAILED]: [false, false],
  [S.EXPIRED]: [false, false],
  [S.CANCELLED]: [false, true],
  [S.REJECTED]: [false, false],
  [S.PREPARING]: [true, true],
  [S.ON_THE_WAY]: [true, true],
  [S.DELIVERED]: [true, true],
};

function timeline(status: OrderStatus, paid: boolean): TimelineEntry[] {
  const entries: TimelineEntry[] = [{ status: S.DRAFT, at: AT }];
  if (paid) {
    entries.push({ status: S.PAID, at: AT });
  }
  entries.push({ status, at: AT });
  return entries;
}

function through(steps: readonly OrderStatus[], note?: string): Order {
  const draft = createDraftOrder(sampleDraftInput(), clock);
  const last = steps.at(-1);
  const path = steps
    .slice(0, -1)
    .reduce<Order>((order, status) => transitionOrder(order, status, clock), draft);
  return last === undefined ? draft : transitionOrder(path, last, clock, note);
}

const TO_AWAITING: readonly OrderStatus[] = [S.RISK_CHECK, S.RESERVED, S.AWAITING_PAYMENT];

describe('isListedInHistory (#101)', () => {
  const cases = Object.values(S).flatMap((status) =>
    [false, true].map((paid) => [status, paid, EXPECTED[status][paid ? 1 : 0]] as const),
  );

  it.each(cases)('%s, odeme kaydi %s -> gorunur: %s', (status, paid, listed) => {
    expect(isListedInHistory({ status, timeline: timeline(status, paid) })).toBe(listed);
  });

  it('tablo butun durumlari kapsar (yeni durum karar ister)', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.values(S).sort());
  });

  it.each([
    ['sepeti birakma', [S.CANCELLED], 'CART_RELEASED'],
    ['yeni sepet', [S.CANCELLED], 'CART_REPLACED'],
    ['stok yetmedi', [S.CANCELLED], 'STOCK_INSUFFICIENT'],
    ['kilit dustu (odeme bekleyen)', [...TO_AWAITING, S.CANCELLED], 'RESERVATION_EXPIRED'],
    ['odeme oncesi kullanici iptali', [...TO_AWAITING, S.CANCELLED], 'USER_CANCELLED'],
    ['odeme hatasindan iptal', [...TO_AWAITING, S.PAYMENT_FAILED, S.CANCELLED], undefined],
  ] as const)('odenmeden iptal GIZLI: %s', (_name, steps, note) => {
    expect(isListedInHistory(through(steps, note))).toBe(false);
  });

  it('odendikten sonra iptal (iade) GORUNUR', () => {
    expect(isListedInHistory(through([...TO_AWAITING, S.PAID, S.CANCELLED]))).toBe(true);
  });

  it('inceleme: REVIEW gorunur; onaydan sonra odeme beklerken gizli, odenince yine gorunur', () => {
    const review = through([S.RISK_CHECK, S.REVIEW]);
    const approved = [S.RESERVED, S.AWAITING_PAYMENT].reduce<Order>(
      (order, status) => transitionOrder(order, status, clock),
      review,
    );
    const paid = transitionOrder(approved, S.PAID, clock);

    expect(isListedInHistory(review)).toBe(true);
    expect(isListedInHistory(approved)).toBe(false);
    expect(isListedInHistory(paid)).toBe(true);
  });
});
