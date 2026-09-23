import { describe, expect, it } from 'vitest';

import {
  createDraftOrderRequestSchema,
  createOrderRequestSchema,
  listMyOrdersRequestSchema,
} from '../../src/interfaces/grpc/schemas.js';

const valid = {
  userId: 'usr_1',
  marketId: 'mkt_migros-jet-moda',
  lines: [{ productId: 'prd_01', sku: 'SUT-1L', quantity: 2 }],
  deliveryLocation: { lat: 40.99, lng: 29.02 },
  deliveryAddress: 'Kadıköy, İstanbul',
  idempotencyKey: '4f1c3a2b-9d8e-11ee',
};

describe('createDraftOrderRequestSchema', () => {
  it('gecerli istegi kabul eder', () => {
    expect(() => createDraftOrderRequestSchema.parse(valid)).not.toThrow();
  });

  it('bos sepeti reddeder', () => {
    expect(() => createDraftOrderRequestSchema.parse({ ...valid, lines: [] })).toThrow();
  });

  it('gecersiz sku bicimini reddeder', () => {
    // SKU deseni @getir/core'da; Redis anahtarinda gectigi icin bosluk olamaz.
    const lines = [{ productId: 'prd_01', sku: 'sut 1l', quantity: 1 }];

    expect(() => createDraftOrderRequestSchema.parse({ ...valid, lines })).toThrow();
  });

  it('sifir ve negatif adedi reddeder', () => {
    for (const quantity of [0, -1]) {
      const lines = [{ productId: 'prd_01', sku: 'SUT-1L', quantity }];
      expect(() => createDraftOrderRequestSchema.parse({ ...valid, lines })).toThrow();
    }
  });

  it('konum yoksa reddeder', () => {
    // proto3'te ic ice mesaj gonderilmezse undefined gelir; sessizce
    // (0,0) varsaymak siparisi Gine Korfezi'ne teslim ettirirdi.
    const { deliveryLocation: _unused, ...withoutLocation } = valid;

    expect(() => createDraftOrderRequestSchema.parse(withoutLocation)).toThrow();
  });

  it('gecersiz enlem/boylami reddeder', () => {
    const deliveryLocation = { lat: 95, lng: 29.02 };

    expect(() => createDraftOrderRequestSchema.parse({ ...valid, deliveryLocation })).toThrow();
  });

  it('idempotency anahtari zorunludur (ADR-08)', () => {
    expect(() => createDraftOrderRequestSchema.parse({ ...valid, idempotencyKey: '' })).toThrow();
    expect(() =>
      createDraftOrderRequestSchema.parse({ ...valid, idempotencyKey: 'kisa' }),
    ).toThrow();
  });
});

describe('createOrderRequestSchema', () => {
  it('siparis kimligi ve kullanici zorunludur', () => {
    const request = { orderId: 'ord_1', userId: 'usr_1', idempotencyKey: '4f1c3a2b-9d8e' };

    expect(() => createOrderRequestSchema.parse(request)).not.toThrow();
    expect(() => createOrderRequestSchema.parse({ ...request, orderId: '' })).toThrow();
    expect(() => createOrderRequestSchema.parse({ ...request, userId: '  ' })).toThrow();
  });
});

describe('listMyOrdersRequestSchema', () => {
  const pageSizeOf = (pageSize: number): number =>
    listMyOrdersRequestSchema.parse({ userId: 'usr_1', page: { pageSize, pageToken: '' } }).page
      .pageSize;

  it('sayfa boyutu reddedilmez, sozlesme sinirlarina oturtulur', () => {
    expect(pageSizeOf(0)).toBe(20);
    expect(pageSizeOf(-5)).toBe(20);
    expect(pageSizeOf(7)).toBe(7);
    expect(pageSizeOf(500)).toBe(100);
  });

  it('page yoksa ilk sayfa, varsayilan boyut', () => {
    expect(listMyOrdersRequestSchema.parse({ userId: 'usr_1' }).page).toEqual({
      pageSize: 20,
      pageToken: undefined,
    });
  });

  it('cozulemeyen jetonu reddeder', () => {
    expect(() =>
      listMyOrdersRequestSchema.parse({ userId: 'usr_1', page: { pageSize: 5, pageToken: 'x' } }),
    ).toThrow();
  });
});
