import { ORDER_STATUS } from '@getir/core';
import { describe, expect, it } from 'vitest';

import {
  CART_MAX_ITEMS,
  COUPON_CODE_MAX_LENGTH,
  createOrderRequestSchema,
  marketProductsQuerySchema,
  loginRequestSchema,
  orderPlacementSchema,
  orderStatusSchema,
  productSchema,
  reservationSchema,
  reserveCartRequestSchema,
  deliveryAddressSchema,
  savedAddressSchema,
  threeDsRequestSchema,
} from '../../src/index.js';

const MARKET_ID = 'mkt_migros-jet-moda';
const PRODUCT_ID = 'prd_sut-1l';
const ORDER_ID = 'ord_db77f4c0e24f49919cc1d78a649c9c94';

const VALID_ADDRESS = {
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
    isActive: true,
    availableQuantity: 12,
  };

  it('REST urunu stok adedini TASIR (proto tarafindakinin aksine)', () => {
    expect(productSchema.parse(base).availableQuantity).toBe(12);
  });

  it('availableQuantity yoksa "stok bilgisi yok" demektir, gecerlidir', () => {
    const { availableQuantity: _omitted, ...withoutStock } = base;

    const parsed = productSchema.parse(withoutStock);
    expect(parsed.availableQuantity).toBeUndefined();
  });

  it('availableQuantity varsa negatif ya da kesirli olamaz', () => {
    expect(productSchema.safeParse({ ...base, availableQuantity: -1 }).success).toBe(false);
    expect(productSchema.safeParse({ ...base, availableQuantity: 1.5 }).success).toBe(false);
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

  it('satis durumu ZORUNLU: pasif teklif de listelenir, istemci ayirt edebilmeli (T7.6)', () => {
    const { isActive: _active, ...withoutActive } = base;

    expect(productSchema.safeParse(withoutActive).success).toBe(false);
    expect(productSchema.parse({ ...base, isActive: false }).isActive).toBe(false);
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
  const valid = {
    marketId: MARKET_ID,
    items: [item],
    address: VALID_ADDRESS,
    expectedTotal: { amountMinor: 19_360, currency: 'TRY' },
  };
  const accepts = (overrides: Record<string, unknown>): boolean =>
    reserveCartRequestSchema.safeParse({ ...valid, ...overrides }).success;

  it('gecerli sepeti kabul eder', () => {
    expect(accepts({})).toBe(true);
  });

  it('sepet TEK MARKETTIR: marketId zorunlu (ADR-15)', () => {
    expect(accepts({ marketId: undefined })).toBe(false);
  });

  it('bos sepeti ve ust sinirdan fazla kalemi reddeder', () => {
    expect(accepts({ items: [] })).toBe(false);
    expect(accepts({ items: Array.from({ length: CART_MAX_ITEMS + 1 }, () => item) })).toBe(false);
  });

  it('sifir adedi reddeder', () => {
    expect(accepts({ items: [{ productId: PRODUCT_ID, quantity: 0 }] })).toBe(false);
  });

  it('istemciden gelen fiyati sessizce yok sayar', () => {
    const parsed = reserveCartRequestSchema.parse({
      ...valid,
      items: [{ ...item, unitPrice: { amountMinor: 1, currency: 'TRY' } }],
    });

    expect(parsed.items[0]).toEqual(item);
  });

  it('T7.5: adres ve beklenen toplam ZORUNLU (tutar ve risk konuma gore hesaplanir)', () => {
    expect(accepts({ address: undefined })).toBe(false);
    expect(accepts({ expectedTotal: undefined })).toBe(false);
    expect(accepts({ address: { ...VALID_ADDRESS, line: '   ' } })).toBe(false);
    expect(accepts({ address: { line: 'Moda', location: { lat: 95, lng: 29 } } })).toBe(false);
  });

  it('kupon istege bagli; sinir order-service ile ayni sabitten', () => {
    expect(accepts({ couponCode: 'ILK10' })).toBe(true);
    expect(accepts({ couponCode: 'A'.repeat(COUPON_CODE_MAX_LENGTH) })).toBe(true);
    expect(accepts({ couponCode: 'A'.repeat(COUPON_CODE_MAX_LENGTH + 1) })).toBe(false);
  });
});

describe('savedAddressSchema (kayitli adres) ve deliveryAddressSchema (siparis)', () => {
  const saved = { ...VALID_ADDRESS, title: 'Ev', note: 'Kadikoy deposuna duser' };

  it('kayitli adres etiket ister; not istege bagli', () => {
    expect(savedAddressSchema.safeParse(saved).success).toBe(true);
    expect(savedAddressSchema.safeParse(VALID_ADDRESS).success).toBe(false);
  });

  it('siparise giderken yalnizca line ve location tasinir (etiket ve not proto da yok)', () => {
    expect(deliveryAddressSchema.parse(saved)).toEqual(VALID_ADDRESS);
  });
});

describe('reservationSchema', () => {
  it('stok rezervasyonu (T11.2) gelene kadar expiresAt yok; durum ve kimlik yeter', () => {
    expect(reservationSchema.safeParse({ orderId: ORDER_ID, status: 'DRAFT' }).success).toBe(true);
  });
});

describe('createOrderRequestSchema', () => {
  it('sepeti ve adresi degil yalnizca orderId ve odemeyi alir (T7.5)', () => {
    const parsed = createOrderRequestSchema.parse({
      orderId: ORDER_ID,
      payment: { method: 'CARD', cardToken: 'tok_demo' },
      items: [{ productId: PRODUCT_ID, quantity: 99 }],
      address: VALID_ADDRESS,
    });

    expect(parsed).toEqual({
      orderId: ORDER_ID,
      payment: { method: 'CARD', cardToken: 'tok_demo' },
    });
  });

  it('kartli odemede jeton zorunlu', () => {
    expect(
      createOrderRequestSchema.safeParse({ orderId: ORDER_ID, payment: { method: 'CARD' } })
        .success,
    ).toBe(false);
  });
});

describe('orderPlacementSchema', () => {
  it('3DS yalnizca bekleniyorsa vardir', () => {
    expect(orderPlacementSchema.safeParse({ orderId: ORDER_ID, status: 'PAID' }).success).toBe(
      true,
    );
    expect(
      orderPlacementSchema.safeParse({
        orderId: ORDER_ID,
        status: 'AWAITING_PAYMENT',
        threeDs: { challengeId: 'tds_1' },
      }).success,
    ).toBe(true);
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
