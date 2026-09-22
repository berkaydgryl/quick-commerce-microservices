import { describe, expect, it } from 'vitest';

import {
  createDraftOrderRequestSchema,
  createOrderRequestSchema,
} from '../../src/interfaces/grpc/schemas.js';

const valid = {
  userId: 'usr_1',
  darkStoreId: 'ds_kadikoy',
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
