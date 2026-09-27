import {
  CART_ITEM_MAX_QUANTITY,
  CART_MAX_ITEMS,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
} from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import {
  cancelOrderRequestSchema,
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

  it('idempotency anahtari sozlesmenin uzunluk sinirlarini birebir uygular', () => {
    // Sinirlar REST basligi ve Redis anahtariyla ayni kaynaktan gelir: REST'in
    // kabul ettigini order reddetmemeli, reddettigini kabul etmemeli.
    const withKey = (length: number) => ({ ...valid, idempotencyKey: 'a'.repeat(length) });

    expect(
      createDraftOrderRequestSchema.safeParse(withKey(IDEMPOTENCY_KEY_MIN_LENGTH - 1)).success,
    ).toBe(false);
    expect(
      createDraftOrderRequestSchema.safeParse(withKey(IDEMPOTENCY_KEY_MIN_LENGTH)).success,
    ).toBe(true);
    expect(
      createDraftOrderRequestSchema.safeParse(withKey(IDEMPOTENCY_KEY_MAX_LENGTH)).success,
    ).toBe(true);
    expect(
      createDraftOrderRequestSchema.safeParse(withKey(IDEMPOTENCY_KEY_MAX_LENGTH + 1)).success,
    ).toBe(false);
  });

  it('sepet sinirlari sozlesmeyle ayni: kalem sayisi ve adet', () => {
    const line = (quantity: number) => ({ productId: 'prd_01', sku: 'SUT-1L', quantity });
    const withLines = (count: number, quantity = 1) => ({
      ...valid,
      lines: Array.from({ length: count }, () => line(quantity)),
    });

    expect(createDraftOrderRequestSchema.safeParse(withLines(CART_MAX_ITEMS)).success).toBe(true);
    expect(createDraftOrderRequestSchema.safeParse(withLines(CART_MAX_ITEMS + 1)).success).toBe(
      false,
    );
    expect(
      createDraftOrderRequestSchema.safeParse(withLines(1, CART_ITEM_MAX_QUANTITY)).success,
    ).toBe(true);
    expect(
      createDraftOrderRequestSchema.safeParse(withLines(1, CART_ITEM_MAX_QUANTITY + 1)).success,
    ).toBe(false);
  });
});

describe('cancelOrderRequestSchema', () => {
  const cancel = {
    orderId: 'ord_1',
    userId: 'usr_1',
    reason: '',
    idempotencyKey: valid.idempotencyKey,
  };

  it('gecerli istegi kabul eder; bos gerekce "gerekce yok" demektir', () => {
    expect(cancelOrderRequestSchema.parse(cancel).reason).toBeUndefined();
  });

  it('idempotency anahtari zorunludur ve sozlesmenin sinirlarini uygular (ADR-08)', () => {
    const withKey = (idempotencyKey: string) => ({ ...cancel, idempotencyKey });

    expect(cancelOrderRequestSchema.safeParse(withKey('')).success).toBe(false);
    expect(
      cancelOrderRequestSchema.safeParse(withKey('a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH - 1)))
        .success,
    ).toBe(false);
    expect(
      cancelOrderRequestSchema.safeParse(withKey('a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH))).success,
    ).toBe(true);
    expect(
      cancelOrderRequestSchema.safeParse(withKey('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH))).success,
    ).toBe(true);
    expect(
      cancelOrderRequestSchema.safeParse(withKey('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1)))
        .success,
    ).toBe(false);
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
