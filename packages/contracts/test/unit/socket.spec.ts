import { EVENTS, ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  SOCKET_EVENTS,
  SOCKET_EVENT_SCHEMAS,
  courierLocationEventSchema,
  orderRoom,
  orderStatusEventSchema,
  realtimeTokenSchema,
  reservationReleasedEventSchema,
  roomJoinPayloadSchema,
  roomSchema,
  stockChangedEventSchema,
  storeRoom,
} from '../../src/index.js';

const ORDER_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const STORE_ID = '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const PRODUCT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const COURIER_ID = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
const AT = '2026-09-21T10:00:00.000Z';

describe('oda adlari', () => {
  it('iki oda turu icin onek uretir', () => {
    expect(orderRoom(ORDER_ID)).toBe(`order:${ORDER_ID}`);
    expect(storeRoom(STORE_ID)).toBe(`store:${STORE_ID}`);
  });

  it('tanimsiz onekli odayi reddeder', () => {
    expect(roomSchema.safeParse(orderRoom(ORDER_ID)).success).toBe(true);
    expect(roomSchema.safeParse(storeRoom(STORE_ID)).success).toBe(true);
    expect(roomSchema.safeParse(`admin:${ORDER_ID}`).success).toBe(false);
  });

  it('jeton tek bir odaya yetkilidir', () => {
    const parsed = realtimeTokenSchema.parse({
      token: 'tok_abc',
      room: orderRoom(ORDER_ID),
      expiresAt: AT,
      ttlSeconds: 60,
    });

    expect(parsed.room).toBe(orderRoom(ORDER_ID));
  });
});

describe('room.join', () => {
  it('store odasi icin jeton istemez', () => {
    expect(roomJoinPayloadSchema.safeParse({ room: storeRoom(STORE_ID) }).success).toBe(true);
  });

  it('jeton verilirse tasir', () => {
    expect(roomJoinPayloadSchema.parse({ room: orderRoom(ORDER_ID), token: 'tok_abc' }).token).toBe(
      'tok_abc',
    );
  });
});

describe('siparis odasi olaylari', () => {
  it('order.status gecis bilgisi ve seq tasir', () => {
    const parsed = orderStatusEventSchema.parse({
      orderId: ORDER_ID,
      status: ORDER_STATUS.PREPARING,
      previousStatus: ORDER_STATUS.PAID,
      at: AT,
      seq: 4,
    });

    expect(parsed.seq).toBe(4);
    expect(parsed.previousStatus).toBe(ORDER_STATUS.PAID);
  });

  it('seq sifir veya negatif olamaz', () => {
    const base = { orderId: ORDER_ID, status: ORDER_STATUS.PAID, at: AT };

    expect(orderStatusEventSchema.safeParse({ ...base, seq: 0 }).success).toBe(false);
    expect(orderStatusEventSchema.safeParse({ ...base, seq: -1 }).success).toBe(false);
  });

  it('reservation.released yalnizca uc gerekce kabul eder', () => {
    const base = { orderId: ORDER_ID, releasedAt: AT, seq: 1 };

    for (const reason of ['EXPIRED', 'CANCELLED', 'PAYMENT_FAILED']) {
      expect(reservationReleasedEventSchema.safeParse({ ...base, reason }).success).toBe(true);
    }

    expect(reservationReleasedEventSchema.safeParse({ ...base, reason: 'REFUNDED' }).success).toBe(
      false,
    );
  });

  it('courier.location konum ve seq tasir, tutar tasimaz', () => {
    const parsed = courierLocationEventSchema.parse({
      orderId: ORDER_ID,
      courierId: COURIER_ID,
      location: { lat: 41.0082, lng: 28.9784 },
      etaMinutes: 7,
      at: AT,
      seq: 12,
    });

    expect(parsed.location.lat).toBe(41.0082);
    expect(Object.hasOwn(parsed, 'total')).toBe(false);
  });
});

describe('stock.changed', () => {
  const event = {
    darkStoreId: STORE_ID,
    productId: PRODUCT_ID,
    availableQuantity: 3,
    at: AT,
  };

  it('darkStoreId tasir', () => {
    expect(stockChangedEventSchema.parse(event).darkStoreId).toBe(STORE_ID);
  });

  it('disariya sku CIKARMAZ, productId kullanir (B11)', () => {
    const parsed = stockChangedEventSchema.parse({ ...event, sku: 'SUT-1L' });

    expect(Object.hasOwn(parsed, 'sku')).toBe(false);
    expect(parsed.productId).toBe(PRODUCT_ID);
  });

  it('depo odasi olayinda seq yoktur', () => {
    expect(Object.hasOwn(stockChangedEventSchema.parse(event), 'seq')).toBe(false);
  });
});

describe('olay sozlugu', () => {
  it('yayinlanan her olayin bir semasi vardir', () => {
    const broadcast = Object.values(SOCKET_EVENTS).filter(
      (name) => name !== SOCKET_EVENTS.ROOM_JOIN,
    );

    expect(Object.keys(SOCKET_EVENT_SCHEMAS).sort()).toEqual([...broadcast].sort());
  });

  it('soket adlari ile ic olay adlari AYRI sozluklerdir', () => {
    // Ikisi bilerek birebir ayni degil: ic taraftaki stock.released, siparis
    // odasina reservation.released olarak cikar.
    expect(SOCKET_EVENTS.RESERVATION_RELEASED).toBe('reservation.released');
    expect(EVENTS.STOCK_RELEASED).toBe('stock.released');
    expect(SOCKET_EVENTS.ORDER_STATUS).not.toBe(EVENTS.ORDER_STATUS_CHANGED);
  });
});
