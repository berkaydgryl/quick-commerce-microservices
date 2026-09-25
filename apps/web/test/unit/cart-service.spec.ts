/**
 * Sepet toplami @getir/pricing ile ve SECILI MARKETIN kurallariyla (ADR-15).
 * Roadmap T6.4 olcutu: ayni sepet iki farkli market kuraliyla farkli toplam verir.
 */

import type { Market } from '@getir/contracts';
import { describe, expect, it } from 'vitest';

import { calculateCartTotals, toPricingRules } from '../../src/features/cart/services/cart.service';
import type { CartItem } from '../../src/features/cart/services/cart-state';

const TRY = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

/** Seed'deki iki market kurali (degerler ornek; testin iddiasi farklilik). */
const MIGROS_RULES: Market['pricingRules'] = {
  minBasket: TRY(4000),
  deliveryFee: TRY(2490),
  freeDeliveryThreshold: TRY(30_000),
};
const MANAV_RULES: Market['pricingRules'] = {
  minBasket: TRY(6000),
  deliveryFee: TRY(1490),
  freeDeliveryThreshold: TRY(20_000),
};

const item = (quantity: number, unitPriceMinor: number): CartItem => ({
  productId: `prd_${unitPriceMinor}`,
  offerId: `ofr_${unitPriceMinor}`,
  sku: `SKU-${unitPriceMinor}`,
  name: 'urun',
  unitPriceMinor,
  quantity,
});

describe('calculateCartTotals', () => {
  it('ayni sepet iki marketin kuraliyla farkli teslimat ve toplam verir', () => {
    const items = [item(2, 2500)]; // 50,00 TL

    const migros = calculateCartTotals(items, MIGROS_RULES);
    const manav = calculateCartTotals(items, MANAV_RULES);

    expect(migros).toMatchObject({
      subtotalMinor: 5000,
      deliveryFeeMinor: 2490,
      totalMinor: 7490,
      canCheckout: true,
    });
    expect(manav).toMatchObject({
      subtotalMinor: 5000,
      deliveryFeeMinor: 1490,
      canCheckout: false,
    });
  });

  it('minimum sepetin altinda: siparis verilemez ve eksik tutar soylenir', () => {
    const totals = calculateCartTotals([item(1, 3490)], MIGROS_RULES);

    expect(totals.canCheckout).toBe(false);
    expect(totals.amountToMinBasketMinor).toBe(510);
  });

  it('ucretsiz teslimat esiginde teslimat 0, kalan tutar 0', () => {
    const totals = calculateCartTotals([item(10, 3000)], MIGROS_RULES);

    expect(totals).toMatchObject({
      deliveryFeeMinor: 0,
      amountToFreeDeliveryMinor: 0,
      totalMinor: 30_000,
    });
  });

  it('esigin altinda ucretsiz teslimata kalan tutar soylenir', () => {
    expect(calculateCartTotals([item(2, 5000)], MIGROS_RULES).amountToFreeDeliveryMinor).toBe(
      20_000,
    );
  });

  it('kupon yok: indirim 0, kupon sonucu yok (kupon alani T17.3)', () => {
    expect(calculateCartTotals([item(2, 5000)], MIGROS_RULES)).toMatchObject({
      discountMinor: 0,
      coupon: null,
    });
  });
});

describe('toPricingRules', () => {
  it('sozlesmedeki Money kurallarini kurus alanlarina cevirir', () => {
    expect(toPricingRules(MIGROS_RULES)).toEqual({
      minBasketMinor: 4000,
      deliveryFeeMinor: 2490,
      freeDeliveryThresholdMinor: 30_000,
    });
  });
});
