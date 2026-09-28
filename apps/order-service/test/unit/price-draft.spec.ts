/**
 * Taslak fiyatlandirmasi (T7.2): saf kural. Sahte catalog'un kurallari:
 * minimum sepet 50 TL, teslimat 14,90 TL, 250 TL ustu ucretsiz; sut 32,50 TL,
 * ekmek 10,00 TL.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { ITEM_UNIT } from '../../src/domain/order-item.js';
import type { CartLine, DraftPricingInput } from '../../src/domain/price-draft.js';
import { assertExpectedTotal, priceDraft } from '../../src/domain/price-draft.js';
import { FAKE_OFFERS, FAKE_RULES } from '../support/fake-catalog-pricing.js';

const milk = (quantity: number): CartLine => ({ productId: 'prd_01', sku: 'SUT-1L', quantity });
const bread = (quantity: number): CartLine => ({ productId: 'prd_02', sku: 'EKMEK-1', quantity });

function price(overrides: Partial<DraftPricingInput> = {}) {
  return priceDraft({
    lines: [milk(2)],
    offers: FAKE_OFFERS,
    rules: FAKE_RULES,
    isFirstOrder: false,
    ...overrides,
  });
}

function rejection(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('hata beklenirdi');
}

describe('priceDraft: kalemler catalog fiyatiyla dondurulur', () => {
  it('ad, birim, sku ve fiyat catalog tekliflerinden gelir; tutar web sepetiyle ayni', () => {
    const { items, pricing } = price({ lines: [milk(2), bread(1)] });

    expect(items).toEqual([
      {
        productId: 'prd_01',
        sku: 'SUT-1L',
        name: 'Süt 1 L',
        unit: ITEM_UNIT.LITER,
        quantity: 2,
        unitPriceMinor: 3_250,
        lineTotalMinor: 6_500,
      },
      {
        productId: 'prd_02',
        sku: 'EKMEK-1',
        name: 'Ekmek',
        unit: ITEM_UNIT.PIECE,
        quantity: 1,
        unitPriceMinor: 1_000,
        lineTotalMinor: 1_000,
      },
    ]);
    // 65,00 + 10,00 = 75,00 ara toplam; esik alti: + 14,90 teslimat.
    expect(pricing).toEqual({
      currency: 'TRY',
      subtotalMinor: 7_500,
      deliveryFeeMinor: 1_490,
      discountMinor: 0,
      totalMinor: 8_990,
    });
  });

  it('ucretsiz teslimat esigi marketin kuralindan: ustunde teslimat 0', () => {
    const { pricing } = price({ lines: [milk(8)] });

    expect(pricing).toMatchObject({
      subtotalMinor: 26_000,
      deliveryFeeMinor: 0,
      totalMinor: 26_000,
    });
  });
});

describe('priceDraft: satista olmayan urun', () => {
  it('o markette satilmayan urunlerin HEPSI tek hatada listelenir', () => {
    const lines: CartLine[] = [
      milk(1),
      { productId: 'prd_yok', sku: 'YOK-1', quantity: 1 },
      { productId: 'prd_pasif', sku: 'PASIF-1', quantity: 1 },
    ];

    const error = rejection(() => price({ lines }));

    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details).toEqual({ unavailableProductIds: ['prd_yok', 'prd_pasif'] });
  });

  it('istemcinin sku degeri catalog ile uyusmuyorsa reddedilir (urun kimligi sessizce degismez)', () => {
    const error = rejection(() =>
      price({ lines: [{ productId: 'prd_01', sku: 'BASKA-SKU', quantity: 1 }] }),
    );

    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details).toEqual({ skuMismatchProductIds: ['prd_01'] });
  });

  it('sku verilmediyse (REST sepeti, T7.5) kaleme catalog teklifinin sku su yazilir', () => {
    // 2 sut (65 TL): minimum sepetin (50 TL) ustunde kalsin.
    const { items } = price({ lines: [{ productId: 'prd_01', quantity: 2 }] });

    expect(items.map((item) => item.sku)).toEqual(['SUT-1L']);
  });
});

describe('priceDraft: minimum sepet', () => {
  it('altinda MIN_BASKET_NOT_MET; ayrintida eksik tutar', () => {
    const error = rejection(() => price({ lines: [bread(1)] }));

    expect(error.code).toBe(ERROR_CODES.MIN_BASKET_NOT_MET);
    expect(error.details).toEqual({ amountToMinBasketMinor: 4_000, minBasketMinor: 5_000 });
  });
});

describe('priceDraft: kupon', () => {
  it('ILK10 ilk sipariste uygulanir; kod normallesmis olarak yazilir', () => {
    const { pricing } = price({ couponCode: ' ilk10 ', isFirstOrder: true });

    // %10 x 65,00 = 6,50 indirim: 65,00 - 6,50 + 14,90 = 73,40.
    expect(pricing).toEqual({
      currency: 'TRY',
      subtotalMinor: 6_500,
      deliveryFeeMinor: 1_490,
      discountMinor: 650,
      totalMinor: 7_340,
      couponCode: 'ILK10',
    });
  });

  it('ILK10 ilk siparis degilse COUPON_INVALID (NOT_FIRST_ORDER)', () => {
    const error = rejection(() => price({ couponCode: 'ILK10', isFirstOrder: false }));

    expect(error.code).toBe(ERROR_CODES.COUPON_INVALID);
    expect(error.details).toEqual({ couponCode: 'ILK10', reason: 'NOT_FIRST_ORDER' });
  });

  it('bilinmeyen kod COUPON_INVALID (UNKNOWN_CODE)', () => {
    const error = rejection(() => price({ couponCode: 'UYDURMA' }));

    expect(error.code).toBe(ERROR_CODES.COUPON_INVALID);
    expect(error.details).toMatchObject({ reason: 'UNKNOWN_CODE' });
  });
});

describe('assertExpectedTotal', () => {
  const { pricing } = price();

  it('istemcinin gordugu toplam tutuyorsa gecer', () => {
    expect(() => assertExpectedTotal(pricing, 7_990)).not.toThrow();
  });

  it('tutmuyorsa PRICE_CHANGED; ayrintida yeni toplam', () => {
    const error = rejection(() => assertExpectedTotal(pricing, 100));

    expect(error.code).toBe(ERROR_CODES.PRICE_CHANGED);
    expect(error.details).toEqual({ expectedTotalMinor: 100, totalMinor: 7_990, currency: 'TRY' });
  });
});

describe('priceDraft: veri tutarliligi', () => {
  it('tekliflerin para birimi karisiksa INTERNAL (catalog veri hatasi)', () => {
    const [first, second] = FAKE_OFFERS;
    if (first === undefined || second === undefined) throw new Error('teklif yok');

    const error = rejection(() =>
      price({ lines: [milk(2), bread(1)], offers: [first, { ...second, currency: 'EUR' }] }),
    );

    expect(error.code).toBe(ERROR_CODES.INTERNAL);
  });
});
