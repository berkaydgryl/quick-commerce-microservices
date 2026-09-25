import { describe, expect, it } from 'vitest';

import { EVENTS, ORDER_STATUS, RISK_BANDS } from '../../src/index.js';

describe('ORDER_STATUS', () => {
  it('anahtar ve deger ayni yazilir', () => {
    for (const [key, value] of Object.entries(ORDER_STATUS)) {
      expect(value).toBe(key);
    }
  });

  it('yasam dongusunun tum duraklarini icerir', () => {
    expect(Object.keys(ORDER_STATUS)).toEqual([
      'DRAFT',
      'RISK_CHECK',
      'REVIEW',
      'RESERVED',
      'AWAITING_PAYMENT',
      'PAID',
      'PAYMENT_FAILED',
      'EXPIRED',
      'CANCELLED',
      'REJECTED',
      'PREPARING',
      'ON_THE_WAY',
      'DELIVERED',
    ]);
  });
});

describe('EVENTS', () => {
  it('olay adlari nokta ile ayrilmis kucuk harftir', () => {
    for (const name of Object.values(EVENTS)) {
      expect(name).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it('sozlesmedeki olaylari tasir', () => {
    expect(EVENTS.ORDER_CREATED).toBe('order.created');
    expect(EVENTS.ORDER_STATUS_CHANGED).toBe('order.status_changed');
    expect(EVENTS.STOCK_RESERVED).toBe('stock.reserved');
    expect(EVENTS.STOCK_COMMITTED).toBe('stock.committed');
    expect(EVENTS.STOCK_RELEASED).toBe('stock.released');
    expect(EVENTS.STOCK_CHANGED).toBe('stock.changed');
    expect(EVENTS.PAYMENT_SUCCEEDED).toBe('payment.succeeded');
    expect(EVENTS.PAYMENT_FAILED).toBe('payment.failed');
    expect(EVENTS.COURIER_ASSIGNED).toBe('courier.assigned');
    expect(EVENTS.COURIER_LOCATION).toBe('courier.location');
    expect(EVENTS.ORDER_DELIVERED).toBe('order.delivered');
  });
});

describe('RISK_BANDS', () => {
  it('dort bant tanimlidir', () => {
    expect(Object.values(RISK_BANDS)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });
});
