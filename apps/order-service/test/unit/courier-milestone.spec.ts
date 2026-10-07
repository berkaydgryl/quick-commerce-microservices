/**
 * Kurye kilometre tasi kurali (T14.3, domain/courier-milestone.ts): her durum
 * x olay x kurye eslesmesi tablosu; picked_up'ta market eslesmesi; gecislerin
 * uygulanmasi (zaman cizelgesi ve surum).
 */

import { fixedClock, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  advanceOrder,
  COURIER_MILESTONE,
  decideMilestone,
  milestoneTime,
} from '../../src/domain/courier-milestone.js';
import type {
  CourierMilestone,
  CourierMilestoneKind,
  MilestoneDecision,
} from '../../src/domain/courier-milestone.js';
import type { Order } from '../../src/domain/order.js';
import { createDraftOrder } from '../../src/domain/order.js';
import { sampleDraftInput } from '../support/order-builders.js';
import { TO_PAID, walk } from '../support/order-store-fixtures.js';

const S = ORDER_STATUS;
const clock = fixedClock(Date.UTC(2026, 9, 7, 20, 0));
const COURIER = 'crr_siparisin-kuryesi';
const OTHER_COURIER = 'crr_baska-kurye';
const MARKET = sampleDraftInput().marketId;

/** Siparisteki kurye: olayinkiyle ayni, baska kurye, kurye yok. */
type CourierMatch = 'same' | 'other' | 'none';
const MATCHES: readonly CourierMatch[] = ['same', 'other', 'none'];

/** Kararin kisa yazimi: tabloda okunur kalsin. */
function short(decision: MilestoneDecision): string {
  switch (decision.kind) {
    case 'APPLY':
      return `APPLY:${decision.steps.join('>')}`;
    case 'STALE':
      return `STALE:${decision.field}`;
    default:
      return decision.kind;
  }
}

const IGNORED_ROW = { PICKED_UP: 'IGNORED', DELIVERED: 'IGNORED' } as const;
const STALE = 'STALE:courier';

/** Durum -> olay -> [ayni kurye, baska kurye, kurye yok]. Her durum yazili. */
const EXPECTED: Readonly<
  Record<OrderStatus, Readonly<Record<CourierMilestoneKind, string | readonly string[]>>>
> = {
  [S.DRAFT]: IGNORED_ROW,
  [S.RISK_CHECK]: IGNORED_ROW,
  [S.REVIEW]: IGNORED_ROW,
  [S.RESERVED]: IGNORED_ROW,
  [S.AWAITING_PAYMENT]: IGNORED_ROW,
  [S.PAYMENT_FAILED]: IGNORED_ROW,
  [S.EXPIRED]: IGNORED_ROW,
  [S.CANCELLED]: IGNORED_ROW,
  [S.REJECTED]: IGNORED_ROW,
  // Kurye henuz yazilmamis: olay beklesin (yeniden teslim).
  [S.PAID]: { PICKED_UP: 'NOT_YET', DELIVERED: 'NOT_YET' },
  [S.PREPARING]: {
    PICKED_UP: ['APPLY:ON_THE_WAY', STALE, 'NOT_YET'],
    DELIVERED: ['APPLY:ON_THE_WAY>DELIVERED', STALE, 'NOT_YET'],
  },
  [S.ON_THE_WAY]: {
    PICKED_UP: ['DUPLICATE', STALE, STALE],
    DELIVERED: ['APPLY:DELIVERED', STALE, STALE],
  },
  [S.DELIVERED]: {
    PICKED_UP: ['DUPLICATE', STALE, STALE],
    DELIVERED: ['DUPLICATE', STALE, STALE],
  },
};

function orderIn(status: OrderStatus, match: CourierMatch): Order {
  const draft = createDraftOrder(sampleDraftInput(), clock);
  const courierId = match === 'same' ? COURIER : OTHER_COURIER;
  return match === 'none'
    ? { ...draft, status }
    : { ...draft, status, courier: { courierId, assignedAt: clock.date() } };
}

function milestoneOf(kind: CourierMilestoneKind, marketId = MARKET): CourierMilestone {
  return kind === COURIER_MILESTONE.PICKED_UP
    ? { kind, courierId: COURIER, marketId }
    : { kind, courierId: COURIER };
}

describe('decideMilestone (T14.3): durum x olay x kurye eslesmesi', () => {
  const cases = Object.values(S).flatMap((status) =>
    Object.values(COURIER_MILESTONE).flatMap((kind) =>
      MATCHES.map((match, index) => {
        const row = EXPECTED[status][kind];
        const expected = typeof row === 'string' ? row : row[index];
        return [status, kind, match, expected] as const;
      }),
    ),
  );

  it.each(cases)('%s + %s, kurye %s -> %s', (status, kind, match, expected) => {
    expect(short(decideMilestone(orderIn(status, match), milestoneOf(kind)))).toBe(expected);
  });

  it('tablo butun durumlari kapsar (yeni durum karar ister)', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.values(S).sort());
  });
});

describe('decideMilestone: picked_up market eslesmesi', () => {
  it.each([S.PREPARING, S.ON_THE_WAY])('%s, kurye ayni ama market baska -> eski olay', (status) => {
    const decision = decideMilestone(
      orderIn(status, 'same'),
      milestoneOf(COURIER_MILESTONE.PICKED_UP, 'mkt_baska-market'),
    );

    expect(short(decision)).toBe('STALE:market');
  });

  it('delivered market tasimaz: yalnizca kurye eslesmesi', () => {
    expect(
      short(
        decideMilestone(orderIn(S.ON_THE_WAY, 'same'), milestoneOf(COURIER_MILESTONE.DELIVERED)),
      ),
    ).toBe('APPLY:DELIVERED');
  });
});

describe('advanceOrder', () => {
  const preparing = (): Order => ({
    ...walk(createDraftOrder(sampleDraftInput(), clock), [...TO_PAID, S.PREPARING]),
    courier: { courierId: COURIER, assignedAt: clock.date() },
  });

  it('teslim once geldiyse iki gecis: zaman cizelgesine ON_THE_WAY ve DELIVERED, surum +2', () => {
    const order = preparing();

    const delivered = advanceOrder(order, [S.ON_THE_WAY, S.DELIVERED], clock.date());

    expect(delivered.status).toBe(S.DELIVERED);
    expect(delivered.timeline.slice(-2).map((entry) => entry.status)).toEqual([
      S.ON_THE_WAY,
      S.DELIVERED,
    ]);
    expect(delivered.version).toBe(order.version + 2);
    expect(delivered.courier).toEqual(order.courier);
  });

  it('paket alindi: tek gecis, surum +1', () => {
    const order = preparing();

    const onTheWay = advanceOrder(order, [S.ON_THE_WAY], clock.date());

    expect(onTheWay.status).toBe(S.ON_THE_WAY);
    expect(onTheWay.version).toBe(order.version + 1);
  });
});

describe('milestoneTime: gecisin ani olayin ani, sinirli', () => {
  const order = walk(createDraftOrder(sampleDraftInput(), clock), [...TO_PAID, S.PREPARING]);
  const last = order.timeline.at(-1)?.at.getTime() ?? 0;
  const now = new Date(last + 10 * 60_000);

  it('aradaki an aynen', () => {
    const occurredAt = new Date(last + 60_000);

    expect(milestoneTime(order, occurredAt, now)).toEqual(occurredAt);
  });

  it('gelecekteki an simdiye cekilir (saat farki)', () => {
    expect(milestoneTime(order, new Date(now.getTime() + 60_000), now)).toEqual(now);
  });

  it('cizelgenin son kaydindan onceki an son kayda cekilir (cizelge sirali kalir)', () => {
    expect(milestoneTime(order, new Date(last - 60_000), now)).toEqual(new Date(last));
  });

  it('gecersiz an simdi', () => {
    expect(milestoneTime(order, new Date(Number.NaN), now)).toEqual(now);
  });
});
