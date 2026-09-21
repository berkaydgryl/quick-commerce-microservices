import { ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  CART_MAX_ITEMS,
  createOrderRequestSchema,
  listProductsQuerySchema,
  loginRequestSchema,
  orderStatusSchema,
  productSchema,
  reserveCartRequestSchema,
  threeDsRequestSchema,
} from '../../src/index.js';

const STORE_ID = '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const PRODUCT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ORDER_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

const VALID_ADDRESS = {
  title: 'Ev',
  line: 'Bagdat Caddesi 12',
  location: { lat: 41.0082, lng: 28.9784 },
};

describe('loginRequestSchema', () => {
  it('E.164 telefonu kabul eder', () => {
    expect(
      loginRequestSchema.safeParse({ phone: '+905551112233', password: 'sifre1234' }).success,
    ).toBe(true);
  });

  it('bicimsiz telefonu reddeder', () => {
    expect(
      loginRequestSchema.safeParse({ phone: '05551112233', password: 'sifre1234' }).success,
    ).toBe(false);
  });

  it('kisa sifreyi reddeder', () => {
    expect(loginRequestSchema.safeParse({ phone: '+905551112233', password: 'kisa' }).success).toBe(
      false,
    );
  });
});

describe('productSchema', () => {
  const base = {
    id: PRODUCT_ID,
    sku: 'SUT-1L',
    name: 'Sut 1 L',
    categoryId: 'cat-1',
    price: { amountMinor: 4599, currency: 'TRY' },
    availableQuantity: 12,
  };

  it('REST urunu stok adedini TASIR (proto tarafindakinin aksine)', () => {
    expect(productSchema.parse(base).availableQuantity).toBe(12);
  });

  it('availableQuantity zorunludur', () => {
    const { availableQuantity: _omitted, ...withoutStock } = base;

    expect(productSchema.safeParse(withoutStock).success).toBe(false);
  });

  it('bicimsiz sku reddedilir', () => {
    expect(productSchema.safeParse({ ...base, sku: 'sut 1l' }).success).toBe(false);
  });
});

describe('listProductsQuerySchema', () => {
  it('darkStoreId zorunludur, cunku stok magaza kapsamlidir', () => {
    expect(listProductsQuerySchema.safeParse({}).success).toBe(false);
    expect(listProductsQuerySchema.safeParse({ darkStoreId: STORE_ID }).success).toBe(true);
  });

  it('tek karakterlik aramayi reddeder', () => {
    expect(listProductsQuerySchema.safeParse({ darkStoreId: STORE_ID, q: 'a' }).success).toBe(
      false,
    );
    expect(listProductsQuerySchema.safeParse({ darkStoreId: STORE_ID, q: 'su' }).success).toBe(
      true,
    );
  });
});

describe('reserveCartRequestSchema', () => {
  const item = { productId: PRODUCT_ID, quantity: 2 };

  it('gecerli sepeti kabul eder', () => {
    expect(
      reserveCartRequestSchema.safeParse({ darkStoreId: STORE_ID, items: [item] }).success,
    ).toBe(true);
  });

  it('bos sepeti reddeder', () => {
    expect(reserveCartRequestSchema.safeParse({ darkStoreId: STORE_ID, items: [] }).success).toBe(
      false,
    );
  });

  it('ust sinirdan fazla kalemi reddeder', () => {
    const items = Array.from({ length: CART_MAX_ITEMS + 1 }, () => item);

    expect(reserveCartRequestSchema.safeParse({ darkStoreId: STORE_ID, items }).success).toBe(
      false,
    );
  });

  it('sifir adedi reddeder', () => {
    expect(
      reserveCartRequestSchema.safeParse({
        darkStoreId: STORE_ID,
        items: [{ productId: PRODUCT_ID, quantity: 0 }],
      }).success,
    ).toBe(false);
  });

  it('istemciden gelen fiyati sessizce yok sayar', () => {
    const parsed = reserveCartRequestSchema.parse({
      darkStoreId: STORE_ID,
      items: [{ ...item, unitPrice: { amountMinor: 1, currency: 'TRY' } }],
    });

    expect(parsed.items[0]).toEqual(item);
  });
});

describe('createOrderRequestSchema', () => {
  it('sepeti degil yalnizca orderId alir', () => {
    const parsed = createOrderRequestSchema.parse({
      orderId: ORDER_ID,
      address: VALID_ADDRESS,
      payment: { method: 'CARD', cardToken: 'tok_demo' },
      items: [{ productId: PRODUCT_ID, quantity: 99 }],
    });

    expect(Object.hasOwn(parsed, 'items')).toBe(false);
  });

  it('adres olmadan kabul etmez', () => {
    expect(
      createOrderRequestSchema.safeParse({ orderId: ORDER_ID, payment: { method: 'CARD' } })
        .success,
    ).toBe(false);
  });
});

describe('threeDsRequestSchema', () => {
  it('alti haneli kodu kabul eder', () => {
    expect(threeDsRequestSchema.safeParse({ challengeId: 'ch_1', otp: '123456' }).success).toBe(
      true,
    );
  });

  it('harf iceren veya kisa kodu reddeder', () => {
    expect(threeDsRequestSchema.safeParse({ challengeId: 'ch_1', otp: '12345' }).success).toBe(
      false,
    );
    expect(threeDsRequestSchema.safeParse({ challengeId: 'ch_1', otp: '12345a' }).success).toBe(
      false,
    );
  });
});

describe('orderStatusSchema', () => {
  it('durum listesini core paketinden alir, kendi kopyasini tutmaz', () => {
    for (const status of Object.values(ORDER_STATUS)) {
      expect(orderStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it('listede olmayan durumu reddeder', () => {
    expect(orderStatusSchema.safeParse('SHIPPED').success).toBe(false);
  });
});
