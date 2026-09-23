/**
 * Sepet hesabi. Kurallar demo marketlerinden (catalog fixtures - ADR-15):
 * paketler app'leri import edemez, degerler burada tekrar yazilir.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import { describe, expect, it } from 'vitest';

import { calculateCart } from '../../src/calculate-cart.js';
import type { CartLine, PricingRules } from '../../src/types.js';

/** Migros Jet - Moda: min 40 TL, teslimat 24,90, 300 TL ustu ucretsiz. */
const MIGROS: PricingRules = {
  minBasketMinor: 4_000,
  deliveryFeeMinor: 2_490,
  freeDeliveryThresholdMinor: 30_000,
};
/** A101 - Caferaga: min 100 TL, teslimat 19,90, 250 TL ustu ucretsiz. */
const A101: PricingRules = {
  minBasketMinor: 10_000,
  deliveryFeeMinor: 1_990,
  freeDeliveryThresholdMinor: 25_000,
};

const NOT_FIRST = { isFirstOrder: false };
const FIRST = { isFirstOrder: true };

/** Tek satirlik sepet: istenen ara toplami uretir. */
function cartOf(subtotalMinor: number): CartLine[] {
  return [{ productId: 'prd_x', unitPriceMinor: subtotalMinor, quantity: 1 }];
}

describe('calculateCart - temel', () => {
  it('ara toplam = birim fiyat x adet; esik altinda teslimat eklenir', () => {
    const totals = calculateCart({
      lines: [
        { productId: 'prd_sut-1l', unitPriceMinor: 3_490, quantity: 2 },
        { productId: 'prd_cikolata-80', unitPriceMinor: 3_290, quantity: 1 },
      ],
      rules: MIGROS,
      context: NOT_FIRST,
    });

    expect(totals).toEqual({
      subtotalMinor: 10_270,
      discountMinor: 0,
      deliveryFeeMinor: 2_490,
      totalMinor: 12_760,
      canCheckout: true,
      amountToMinBasketMinor: 0,
      amountToFreeDeliveryMinor: 19_730,
      coupon: null,
    });
  });

  it('AYNI sepet iki marketin kurallariyla FARKLI toplam verir (ADR-15, T4.3 olcutu)', () => {
    const migros = calculateCart({ lines: cartOf(20_000), rules: MIGROS, context: NOT_FIRST });
    const a101 = calculateCart({ lines: cartOf(20_000), rules: A101, context: NOT_FIRST });

    expect(migros.totalMinor).toBe(22_490);
    expect(a101.totalMinor).toBe(21_990);
    expect(migros.amountToFreeDeliveryMinor).toBe(10_000);
    expect(a101.amountToFreeDeliveryMinor).toBe(5_000);
  });

  it('esikte (dahil) teslimat ucretsiz; "daha ekle" 0', () => {
    const totals = calculateCart({ lines: cartOf(25_000), rules: A101, context: NOT_FIRST });

    expect(totals.deliveryFeeMinor).toBe(0);
    expect(totals.amountToFreeDeliveryMinor).toBe(0);
  });

  it('minimum sepet altinda siparis verilemez ve eksik tutar soylenir', () => {
    const totals = calculateCart({ lines: cartOf(8_500), rules: A101, context: NOT_FIRST });

    expect(totals.canCheckout).toBe(false);
    expect(totals.amountToMinBasketMinor).toBe(1_500);
  });

  it('minimum sepet sinirda (esit) siparis verilebilir', () => {
    expect(
      calculateCart({ lines: cartOf(10_000), rules: A101, context: NOT_FIRST }).canCheckout,
    ).toBe(true);
  });

  it('bos sepet siparise donusmez', () => {
    const totals = calculateCart({
      lines: [],
      rules: { ...MIGROS, minBasketMinor: 0 },
      context: NOT_FIRST,
    });

    expect(totals.canCheckout).toBe(false);
    expect(totals.subtotalMinor).toBe(0);
  });
});

describe('calculateCart - kuponlar ve B12 hesap sirasi', () => {
  it('B12: esik ustu sepet + KARGOBEDAVA -> teslimat TEK KEZ sifirlanir, cift indirim yok', () => {
    // Roadmap testi: 260 TL sepet + kargo kuponu.
    const totals = calculateCart({
      lines: cartOf(26_000),
      rules: A101,
      context: NOT_FIRST,
      couponCode: 'KARGOBEDAVA',
    });

    expect(totals.deliveryFeeMinor).toBe(0);
    expect(totals.discountMinor).toBe(0);
    expect(totals.totalMinor).toBe(26_000);
    expect(totals.coupon).toEqual({ code: 'KARGOBEDAVA', applied: true });
  });

  it('KARGOBEDAVA esik altinda teslimati sifirlar; "daha ekle" 0 olur', () => {
    const totals = calculateCart({
      lines: cartOf(16_000),
      rules: MIGROS,
      context: NOT_FIRST,
      couponCode: 'kargobedava',
    });

    expect(totals.deliveryFeeMinor).toBe(0);
    expect(totals.totalMinor).toBe(16_000);
    expect(totals.amountToFreeDeliveryMinor).toBe(0);
  });

  it('KARGOBEDAVA 150 TL altinda uygulanmaz, sebebi doner', () => {
    const totals = calculateCart({
      lines: cartOf(14_999),
      rules: MIGROS,
      context: NOT_FIRST,
      couponCode: 'KARGOBEDAVA',
    });

    expect(totals.deliveryFeeMinor).toBe(2_490);
    expect(totals.coupon).toEqual({
      code: 'KARGOBEDAVA',
      applied: false,
      reason: 'BELOW_MIN_SUBTOTAL',
    });
  });

  it('ILK10: %10 indirim; teslimat esigi INDIRIM ONCESI tutara bakar (B12)', () => {
    // 260 TL sepet, %10 = 26 TL indirim. Esik 250 TL: indirim sonrasi 234 TL
    // olsa da teslimat UCRETSIZ kalir - indirim teslimati geri ucretli yapmaz.
    const totals = calculateCart({
      lines: cartOf(26_000),
      rules: A101,
      context: FIRST,
      couponCode: 'ILK10',
    });

    expect(totals.discountMinor).toBe(2_600);
    expect(totals.deliveryFeeMinor).toBe(0);
    expect(totals.totalMinor).toBe(23_400);
  });

  it('ILK10 en cok 30 TL', () => {
    const totals = calculateCart({
      lines: cartOf(80_000),
      rules: MIGROS,
      context: FIRST,
      couponCode: 'ILK10',
    });

    expect(totals.discountMinor).toBe(3_000);
  });

  it('ILK10 kurus altini asagi yuvarlar (tam sayi aritmetigi, float yok)', () => {
    const totals = calculateCart({
      lines: cartOf(12_345),
      rules: MIGROS,
      context: FIRST,
      couponCode: 'ILK10',
    });

    expect(totals.discountMinor).toBe(1_234);
    expect(Number.isInteger(totals.totalMinor)).toBe(true);
  });

  it('ILK10 ilk siparis degilse uygulanmaz', () => {
    const totals = calculateCart({
      lines: cartOf(20_000),
      rules: MIGROS,
      context: NOT_FIRST,
      couponCode: 'ILK10',
    });

    expect(totals.discountMinor).toBe(0);
    expect(totals.coupon).toEqual({ code: 'ILK10', applied: false, reason: 'NOT_FIRST_ORDER' });
  });

  it('kupon minimum sepeti etkilemez: indirim sepeti minimumun altina dusurmez', () => {
    // A101 min 100 TL; 105 TL sepette %10 indirim 94,50 TL'ye dusurur ama
    // minimum ARA TOPLAMA bakar - kupon siparisi engellememeli.
    const totals = calculateCart({
      lines: cartOf(10_500),
      rules: A101,
      context: FIRST,
      couponCode: 'ILK10',
    });

    expect(totals.canCheckout).toBe(true);
    expect(totals.totalMinor).toBe(10_500 - 1_050 + 1_990);
  });

  it('kucuk harf ve bosluk onemsiz; TURKCE "i" TUZAGINA dusmez', () => {
    // toLocaleUpperCase('tr') "ilk10" -> "İLK10" yapardi ve kupon hic eslesmezdi.
    const totals = calculateCart({
      lines: cartOf(20_000),
      rules: MIGROS,
      context: FIRST,
      couponCode: '  ilk10 ',
    });

    expect(totals.coupon).toEqual({ code: 'ilk10', applied: true });
    expect(totals.discountMinor).toBe(2_000);
  });

  it('bilinmeyen kod hata FIRLATMAZ, sebebiyle doner', () => {
    const totals = calculateCart({
      lines: cartOf(20_000),
      rules: MIGROS,
      context: NOT_FIRST,
      couponCode: 'BEDAVA100',
    });

    expect(totals.coupon).toEqual({ code: 'BEDAVA100', applied: false, reason: 'UNKNOWN_CODE' });
    expect(totals.totalMinor).toBe(22_490);
  });

  it('bos ya da yalnizca bosluk kod "kupon yok" sayilir', () => {
    expect(
      calculateCart({ lines: cartOf(20_000), rules: MIGROS, context: NOT_FIRST, couponCode: '   ' })
        .coupon,
    ).toBeNull();
  });
});

describe('calculateCart - degismezler', () => {
  it.each([
    ['negatif fiyat', { productId: 'prd_x', unitPriceMinor: -1, quantity: 1 }],
    ['kurus disi fiyat', { productId: 'prd_x', unitPriceMinor: 34.9, quantity: 1 }],
    ['sifir adet', { productId: 'prd_x', unitPriceMinor: 100, quantity: 0 }],
    ['kesirli adet', { productId: 'prd_x', unitPriceMinor: 100, quantity: 1.5 }],
  ])('%s VALIDATION_FAILED', (_label, line) => {
    const failing = (): unknown =>
      calculateCart({ lines: [line], rules: MIGROS, context: NOT_FIRST });

    expect(failing).toThrow(AppError);
    expect(failing).toThrow(
      expect.objectContaining({ code: ERROR_CODES.VALIDATION_FAILED }) as Error,
    );
  });

  it('bozuk market kurali (kurus disi) VALIDATION_FAILED', () => {
    expect(() =>
      calculateCart({
        lines: cartOf(1_000),
        rules: { ...MIGROS, deliveryFeeMinor: 24.9 },
        context: NOT_FIRST,
      }),
    ).toThrow(AppError);
  });
});
