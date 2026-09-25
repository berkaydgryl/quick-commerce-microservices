/**
 * Sepet toplami: @getir/pricing'in calculateCart'i. Order-service ayni
 * fonksiyonu cagirir; boylece ekranda gorulen ile odenen tutar birbirini tutar
 * (tutmazsa siparis PRICE_CHANGED ile reddedilir, T7.2).
 *
 * Kurallar SECILI MARKETTEN gelir (ADR-15): minimum sepet, teslimat ucreti ve
 * ucretsiz teslimat esigi market.pricingRules'tadir; burada sabit yoktur.
 */

import type { Market } from '@getir/contracts';
import { calculateCart } from '@getir/pricing';
import type { CartTotals, PricingRules } from '@getir/pricing';

import type { CartItem } from './cart-state';

/**
 * Kupon ve ilk-siparis kosulu burada YOK: oturum T8'de, kupon alani T17.3'te
 * gelir. Bugun ilk siparis bilinmedigi icin "degil" varsayilir; bu yalnizca
 * kupon kosulunu etkiler, toplam kurallarini degil.
 */
const NO_COUPON_CONTEXT = { isFirstOrder: false } as const;

/** Sozlesmedeki market kurallari (Money) -> pricing paketinin kurus alanlari. */
export function toPricingRules(rules: Market['pricingRules']): PricingRules {
  return {
    minBasketMinor: rules.minBasket.amountMinor,
    deliveryFeeMinor: rules.deliveryFee.amountMinor,
    freeDeliveryThresholdMinor: rules.freeDeliveryThreshold.amountMinor,
  };
}

export function calculateCartTotals(
  items: readonly CartItem[],
  rules: Market['pricingRules'],
): CartTotals {
  return calculateCart({
    lines: items.map((item) => ({
      productId: item.productId,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
    })),
    rules: toPricingRules(rules),
    context: NO_COUPON_CONTEXT,
  });
}
