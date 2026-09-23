/**
 * Durum makinesi: tablo BIR SPESIFIKASYONDUR. Beklenen kenarlar roadmap
 * diyagramindan (+ B20, B29) birebir yazildi; tabloya habersiz eklenen ya da
 * silinen bir gecis burada kirmizi olur.
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { OrderStatus } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  assertTransition,
  canTransition,
  isTerminal,
  ORDER_TRANSITIONS,
  USER_CANCELLABLE,
} from '../../src/domain/order-state-machine.js';

const S = ORDER_STATUS;

/** Roadmap "Siparis Durum Makinesi" diyagrami + B20 + B29. */
const EXPECTED_EDGES: readonly (readonly [OrderStatus, OrderStatus])[] = [
  [S.DRAFT, S.RISK_CHECK],
  [S.DRAFT, S.CANCELLED], // B29
  [S.RISK_CHECK, S.REJECTED],
  [S.RISK_CHECK, S.REVIEW], // B20a
  [S.RISK_CHECK, S.RESERVED],
  [S.RISK_CHECK, S.CANCELLED], // B20b
  [S.REVIEW, S.RESERVED], // B20a
  [S.REVIEW, S.REJECTED], // B20a
  [S.RESERVED, S.EXPIRED],
  [S.RESERVED, S.AWAITING_PAYMENT],
  [S.RESERVED, S.CANCELLED], // B29
  [S.AWAITING_PAYMENT, S.PAYMENT_FAILED],
  [S.AWAITING_PAYMENT, S.PAID],
  [S.AWAITING_PAYMENT, S.CANCELLED], // B29
  [S.PAYMENT_FAILED, S.CANCELLED],
  [S.EXPIRED, S.CANCELLED],
  [S.PAID, S.CANCELLED], // B20c
  [S.PAID, S.PREPARING],
  [S.PREPARING, S.ON_THE_WAY],
  [S.ON_THE_WAY, S.DELIVERED],
];

const ALL: readonly OrderStatus[] = Object.values(ORDER_STATUS);

function actualEdges(): string[] {
  return ALL.flatMap((from) => ORDER_TRANSITIONS[from].map((to) => `${from}->${to}`)).sort();
}

describe('gecis tablosu', () => {
  it('roadmap diyagramindaki kenarlarla BIREBIR ayni (fazlasi da eksigi de yok)', () => {
    expect(actualEdges()).toEqual(EXPECTED_EDGES.map(([from, to]) => `${from}->${to}`).sort());
  });

  it('her durum DRAFT tan erisilebilir (olu durum yok)', () => {
    const reached = new Set<OrderStatus>([S.DRAFT]);
    const queue: OrderStatus[] = [S.DRAFT];
    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      for (const next of ORDER_TRANSITIONS[current]) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }

    expect([...reached].sort()).toEqual([...ALL].sort());
  });

  it('son durumlar yalnizca DELIVERED, CANCELLED, REJECTED', () => {
    expect(ALL.filter(isTerminal).sort()).toEqual([S.CANCELLED, S.DELIVERED, S.REJECTED].sort());
  });

  it('her ara durumdan bir son duruma ulasilir (siparis asili kalamaz)', () => {
    const canFinish = (status: OrderStatus, seen = new Set<OrderStatus>()): boolean => {
      if (isTerminal(status)) return true;
      if (seen.has(status)) return false;
      seen.add(status);
      return ORDER_TRANSITIONS[status].some((next) => canFinish(next, seen));
    };

    for (const status of ALL) {
      expect(canFinish(status)).toBe(true);
    }
  });

  it('kullanici iptali yalnizca DRAFT, RESERVED, AWAITING_PAYMENT; hepsi tabloda gecerli', () => {
    expect([...USER_CANCELLABLE].sort()).toEqual([S.AWAITING_PAYMENT, S.DRAFT, S.RESERVED].sort());
    for (const status of USER_CANCELLABLE) {
      expect(canTransition(status, S.CANCELLED)).toBe(true);
    }
  });
});

describe('assertTransition', () => {
  it.each([
    [S.DRAFT, S.AWAITING_PAYMENT], // T3.2 kisayolu: artik gecersiz
    [S.DRAFT, S.PAID],
    [S.DELIVERED, S.CANCELLED],
    [S.CANCELLED, S.DRAFT],
    [S.REVIEW, S.CANCELLED],
    [S.ON_THE_WAY, S.PREPARING],
  ])('%s -> %s ORDER_STATE_INVALID firlatir, ayrinti gecisi soyler', (from, to) => {
    try {
      assertTransition('ord_x', from, to);
      expect.unreachable(`${from} -> ${to} gecersiz olmaliydi`);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ERROR_CODES.ORDER_STATE_INVALID);
      expect((error as AppError).details).toEqual({ orderId: 'ord_x', from, to });
    }
  });

  it('gecerli gecis sessiz gecer', () => {
    expect(() => assertTransition('ord_x', S.RESERVED, S.AWAITING_PAYMENT)).not.toThrow();
  });
});
