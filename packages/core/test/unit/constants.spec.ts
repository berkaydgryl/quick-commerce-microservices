import { describe, expect, it } from 'vitest';

import { EVENTS, ORDER_STATUS, REDIS_KEY, RISK_BANDS, redisHashTag } from '../../src/index.js';

const STORE_ID = 'store-1';
const OTHER_STORE_ID = 'store-2';
const SKU = 'SKU-42';
const ORDER_ID = 'ord_0123456789abcdef0123456789abcdef';
const USER_ID = 'usr_0123456789abcdef0123456789abcdef';
const COURIER_ID = 'crr_0123456789abcdef0123456789abcdef';

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

describe('REDIS_KEY', () => {
  it('anahtarlari sozlesmedeki bicimde uretir', () => {
    expect(REDIS_KEY.stockAvail(STORE_ID, SKU)).toBe('stock:{store-1}:avail:{SKU-42}');
    expect(REDIS_KEY.reservation(STORE_ID, ORDER_ID)).toBe(`resv:{store-1}:{${ORDER_ID}}`);
    expect(REDIS_KEY.reservationIndex(STORE_ID)).toBe('resv:index:{store-1}');
    expect(REDIS_KEY.reservationsByUser(USER_ID)).toBe(`resv:user:{${USER_ID}}`);
    expect(REDIS_KEY.courierTrack(COURIER_ID)).toBe(`courier:{${COURIER_ID}}:track`);
    expect(REDIS_KEY.courierLast(COURIER_ID)).toBe(`courier:{${COURIER_ID}}:last`);
    expect(REDIS_KEY.idempotency('abc')).toBe('idem:{abc}');
    expect(REDIS_KEY.rateLimit('10.0.0.1', '/orders')).toBe('rate:{10.0.0.1}:{/orders}');
    expect(REDIS_KEY.eventStream).toBe('stream:events');
    expect(REDIS_KEY.reconcileLock).toBe('lock:reconcile');
  });

  it("stok ve rezervasyon anahtarlari ayni hash-tag'i (magaza) tasir", () => {
    const keys = [
      REDIS_KEY.stockAvail(STORE_ID, SKU),
      REDIS_KEY.stockAvail(STORE_ID, 'SKU-7'),
      REDIS_KEY.reservation(STORE_ID, ORDER_ID),
      REDIS_KEY.reservationIndex(STORE_ID),
    ];

    for (const key of keys) {
      expect(redisHashTag(key)).toBe(STORE_ID);
    }
  });

  it('farkli magazalar farkli hash-tag alir', () => {
    expect(redisHashTag(REDIS_KEY.stockAvail(OTHER_STORE_ID, SKU))).toBe(OTHER_STORE_ID);
    expect(redisHashTag(REDIS_KEY.stockAvail(STORE_ID, SKU))).not.toBe(
      redisHashTag(REDIS_KEY.stockAvail(OTHER_STORE_ID, SKU)),
    );
  });

  it('kullanici, kurye, idempotency ve rate-limit anahtarlari kendi kimligiyle etiketlenir', () => {
    expect(redisHashTag(REDIS_KEY.reservationsByUser(USER_ID))).toBe(USER_ID);
    expect(redisHashTag(REDIS_KEY.courierTrack(COURIER_ID))).toBe(COURIER_ID);
    expect(redisHashTag(REDIS_KEY.courierLast(COURIER_ID))).toBe(COURIER_ID);
    expect(redisHashTag(REDIS_KEY.idempotency('abc'))).toBe('abc');
    expect(redisHashTag(REDIS_KEY.rateLimit('10.0.0.1', '/orders'))).toBe('10.0.0.1');
  });

  it('tekil anahtarlarda hash-tag yoktur', () => {
    expect(redisHashTag(REDIS_KEY.eventStream)).toBeUndefined();
    expect(redisHashTag(REDIS_KEY.reconcileLock)).toBeUndefined();
  });
});
