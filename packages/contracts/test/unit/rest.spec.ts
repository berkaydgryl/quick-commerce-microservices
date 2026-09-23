import { ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  CART_MAX_ITEMS,
  createOrderRequestSchema,
  marketProductsQuerySchema,
  loginRequestSchema,
  orderStatusSchema,
  productSchema,
  reserveCartRequestSchema,
  threeDsRequestSchema,
} from '../../src/index.js';

const MARKET_ID = 'mkt_migros-jet-moda';
const PRODUCT_ID = 'prd_sut-1l';
const ORDER_ID = 'ord_db77f4c0e24f49919cc1d78a649c9c94';

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
    offerId: 'ofr_migros-jet-moda-sut-1l',
    marketId: MARKET_ID,
    sku: 'SUT-1L',
    name: 'Sut 1 L',
    categoryId: 'cat_sut-kahvaltilik',
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

  it('urun bir market BAGLAMINDA doner: marketId ve offerId zorunlu (ADR-15)', () => {
    const { marketId: _market, ...withoutMarket } = base;
    const { offerId: _offer, ...withoutOffer } = base;

    expect(productSchema.safeParse(withoutMarket).success).toBe(false);
    expect(productSchema.safeParse(withoutOffer).success).toBe(false);
  });
});

describe('marketProductsQuerySchema', () => {
  it('marketId sorguda DEGIL yolda: bos sorgu gecerlidir', () => {
    expect(marketProductsQuerySchema.safeParse({}).success).toBe(true);
  });

  it('kategori onekli katalog kimligi olmali', () => {
    expect(marketProductsQuerySchema.safeParse({ categoryId: 'cat_icecek' }).success).toBe(true);
    expect(marketProductsQuerySchema.safeParse({ categoryId: 'icecek' }).success).toBe(false);
  });

  it('tek karakterlik aramayi reddeder', () => {
    expect(marketProductsQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(marketProductsQuerySchema.safeParse({ q: 'su' }).success).toBe(true);
  });
});

describe('reserveCartRequestSchema', () => {
  const item = { productId: PRODUCT_ID, quantity: 2 };

  it('sepet TEK MARKETTIR: marketId zorunlu (ADR-15)', () => {
    expect(reserveCartRequestSchema.safeParse({ items: [item] }).success).toBe(false);
  });

  it('gecerli sepeti kabul eder', () => {
    expect(reserveCartRequestSchema.safeParse({ marketId: MARKET_ID, items: [item] }).success).toBe(
      true,
    );
  });

  it('bos sepeti reddeder', () => {
    expect(reserveCartRequestSchema.safeParse({ marketId: MARKET_ID, items: [] }).success).toBe(
      false,
    );
  });

  it('ust sinirdan fazla kalemi reddeder', () => {
    const items = Array.from({ length: CART_MAX_ITEMS + 1 }, () => item);

    expect(reserveCartRequestSchema.safeParse({ marketId: MARKET_ID, items }).success).toBe(false);
  });

  it('sifir adedi reddeder', () => {
    expect(
      reserveCartRequestSchema.safeParse({
        marketId: MARKET_ID,
        items: [{ productId: PRODUCT_ID, quantity: 0 }],
      }).success,
    ).toBe(false);
  });

  it('istemciden gelen fiyati sessizce yok sayar', () => {
    const parsed = reserveCartRequestSchema.parse({
      marketId: MARKET_ID,
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
