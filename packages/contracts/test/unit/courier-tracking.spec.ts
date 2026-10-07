/**
 * Kurye takibi sozlesmesi (T13.3, asama 1): courier -> order olay govdeleri
 * (paket alindi, teslim edildi) ve GET /v1/orders/{orderId}/tracking cevabi.
 * order (T14.3) ve gateway bu semalardan gecirir; web isCourierApproaching ile
 * bir kez bildirir.
 */

import { ID_PREFIX, newId } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  COURIER_APPROACHING_METERS,
  COURIER_ROUTE_MAX_POINTS,
  courierAssignedEventSchema,
  courierDeliveredPayloadSchema,
  courierPickedUpPayloadSchema,
  isCourierApproaching,
  orderTrackingSchema,
  trackingPhaseSchema,
} from '../../src/index.js';

const orderId = newId(ID_PREFIX.ORDER);
const courierId = newId(ID_PREFIX.COURIER);
const point = (index: number) => ({ lat: 40.98 + index / 10_000, lng: 29.02 + index / 10_000 });
/** Market -> adres parcasi: ilk nokta market, son nokta adres. */
const route = Array.from({ length: 12 }, (_, index) => point(index));

/** Paket alinmis, yoldaki kurye (TO_CUSTOMER). */
const onTheWay = {
  orderId,
  status: 'ON_THE_WAY',
  phase: 'TO_CUSTOMER',
  courier: { id: courierId, name: 'Mehmet K.' },
  location: point(3),
  at: '2026-10-07T13:00:02.000Z',
  remainingMeters: 840,
  etaSeconds: 68,
  route,
  marketLocation: point(0),
  deliveryLocation: point(11),
  pickedUpAt: '2026-10-07T12:59:30.000Z',
};

/** Markete giden ya da hazirligi bekleyen kurye (TO_MARKET): konum, alma ani yok; tahmin dakikada. */
const { location: _location, pickedUpAt: _pickedUpAt, ...withoutPickup } = onTheWay;
const preparing = {
  ...withoutPickup,
  status: 'PREPARING',
  phase: 'TO_MARKET',
  remainingMeters: 1100,
  etaSeconds: 240,
};

const delivered = {
  ...onTheWay,
  status: 'DELIVERED',
  phase: 'DELIVERED',
  location: point(11),
  remainingMeters: 0,
  etaSeconds: 0,
  deliveredAt: '2026-10-07T13:01:10.000Z',
};

/** Reddedilen alanlarin yollari. */
function failingPaths(value: unknown): string[] {
  const result = orderTrackingSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('kurye olaylari (courier -> order)', () => {
  it('paket alindi: siparis, kurye ve market', () => {
    const payload = { orderId, courierId, marketId: 'mkt_migros-jet-moda' };

    expect(courierPickedUpPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('teslim edildi: siparis ve kurye', () => {
    expect(courierDeliveredPayloadSchema.parse({ orderId, courierId })).toEqual({
      orderId,
      courierId,
    });
  });

  it('kimlikler kendi oneklerini ister: kurye crr_, siparis ord_', () => {
    const wrong = [
      { orderId, courierId: newId(ID_PREFIX.USER) },
      { orderId: newId(ID_PREFIX.PAYMENT), courierId },
      { orderId, courierId: `${courierId}0` },
    ];
    for (const payload of wrong) {
      expect(
        courierDeliveredPayloadSchema.safeParse(payload).success,
        JSON.stringify(payload),
      ).toBe(false);
    }
    expect(
      courierPickedUpPayloadSchema.safeParse({ orderId, courierId, marketId: 'migros' }).success,
    ).toBe(false);
  });
});

describe('GET /v1/orders/{orderId}/tracking (orderTrackingSchema)', () => {
  it('asamalar: markete, musteriye, teslim edildi (3 adimli takip)', () => {
    expect(trackingPhaseSchema.options).toEqual(['TO_MARKET', 'TO_CUSTOMER', 'DELIVERED']);
  });

  it('uc asamanin gecerli hali gecer', () => {
    for (const tracking of [preparing, onTheWay, delivered]) {
      expect(orderTrackingSchema.parse(tracking), tracking.phase).toEqual(tracking);
    }
  });

  it('GIZLILIK: paket alinmadan (TO_MARKET) kurye konumu VERILMEZ; sonra zorunlu (onceki musterinin adresi sizmasin)', () => {
    expect(failingPaths({ ...preparing, location: point(1) })).toEqual(['location']);
    const { location: _hidden, ...noLocation } = onTheWay;
    expect(failingPaths(noLocation)).toEqual(['location']);
  });

  it('GIZLILIK: paket alinmadan tahmin dakikaya yuvarlanir (kalanin azalisi kurye -> market uzakligini ele vermesin)', () => {
    expect(failingPaths({ ...preparing, etaSeconds: 241 })).toEqual(['etaSeconds']);
    expect(failingPaths({ ...onTheWay, etaSeconds: 67 })).toEqual([]);
  });

  it('asama ile anlar ve kalanlar tutarli', () => {
    expect(failingPaths({ ...preparing, pickedUpAt: onTheWay.pickedUpAt })).toEqual(['pickedUpAt']);
    const { pickedUpAt: _picked, ...noPickup } = onTheWay;
    expect(failingPaths(noPickup)).toEqual(['pickedUpAt']);
    expect(failingPaths({ ...onTheWay, deliveredAt: delivered.deliveredAt })).toEqual([
      'deliveredAt',
    ]);
    const { deliveredAt: _delivered, ...notDelivered } = delivered;
    expect(failingPaths(notDelivered)).toEqual(['deliveredAt']);
    expect(failingPaths({ ...delivered, remainingMeters: 500 })).toEqual(['remainingMeters']);
  });

  it('iptal edilmis ya da odenmemis siparisin takibi yok: durum yalnizca PREPARING, ON_THE_WAY, DELIVERED', () => {
    for (const status of ['CANCELLED', 'PAID', 'REVIEW']) {
      expect(failingPaths({ ...onTheWay, status }), status).toEqual(['status']);
    }
  });

  it(`rota market -> adres parcasi: 1-${COURIER_ROUTE_MAX_POINTS} nokta (adres marketin kendisiyse tek nokta)`, () => {
    const withPoints = (count: number) =>
      failingPaths({
        ...onTheWay,
        route: Array.from({ length: count }, (_, index) => point(index)),
      });

    expect(withPoints(1)).toEqual([]);
    expect(withPoints(COURIER_ROUTE_MAX_POINTS)).toEqual([]);
    expect(withPoints(0)).toEqual(['route']);
    expect(withPoints(COURIER_ROUTE_MAX_POINTS + 1)).toEqual(['route']);
  });

  it('kalanlar tam sayi ve negatif degil; kurye kimligi ve adi zorunlu', () => {
    for (const broken of [
      { remainingMeters: -5 },
      { etaSeconds: 2.5 },
      { courier: { id: courierId, name: '' } },
      { courier: { id: newId(ID_PREFIX.USER), name: 'Mehmet K.' } },
      { at: 'dun' },
    ]) {
      expect(orderTrackingSchema.safeParse({ ...onTheWay, ...broken }).success).toBe(false);
    }
  });
});

describe('kurye yaklasti bildirimi (web, bir kez)', () => {
  it(`yalnizca paket alindiktan sonra ve kalan ${COURIER_APPROACHING_METERS} m ya da az`, () => {
    expect(COURIER_APPROACHING_METERS).toBe(300);
    expect(isCourierApproaching({ phase: 'TO_CUSTOMER', remainingMeters: 300 })).toBe(true);
    expect(isCourierApproaching({ phase: 'TO_CUSTOMER', remainingMeters: 301 })).toBe(false);
    // Markette beklerken adres yakin olsa da yaklasma degil.
    expect(isCourierApproaching({ phase: 'TO_MARKET', remainingMeters: 250 })).toBe(false);
    expect(isCourierApproaching({ phase: 'DELIVERED', remainingMeters: 0 })).toBe(false);
  });
});

describe('courier.assigned soket olayi', () => {
  it('GIZLILIK: kurye konumu TASIMAZ (atamada kurye onceki musterinin adresindedir)', () => {
    const parsed = courierAssignedEventSchema.parse({
      orderId,
      courier: { id: courierId, name: 'Mehmet K.', location: point(1), etaMinutes: 4 },
      at: '2026-10-07T12:58:00.000Z',
      seq: 3,
    });

    expect(parsed.courier).toEqual({ id: courierId, name: 'Mehmet K.', etaMinutes: 4 });
  });
});
