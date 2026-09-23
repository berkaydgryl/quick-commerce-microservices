/**
 * Teslimat ucreti ve "su kadar daha ekle" hesaplari (saf).
 *
 * Esik INDIRIM ONCESI ara toplama bakar (B12): indirim teslimati ucretli
 * hale geri dondurmesin, "X TL daha ekle" mesaji kuponla ziplamasin.
 */

import { clampToZero } from './money.js';
import type { PricingRules } from './types.js';

/** Esige ulasildiysa 0, degilse marketin teslimat ucreti. */
export function deliveryFeeFor(subtotalMinor: number, rules: PricingRules): number {
  return subtotalMinor >= rules.freeDeliveryThresholdMinor ? 0 : rules.deliveryFeeMinor;
}

/** "Minimum sepete X TL kaldi". */
export function amountToMinBasket(subtotalMinor: number, rules: PricingRules): number {
  return clampToZero(rules.minBasketMinor - subtotalMinor);
}

/**
 * "X TL daha ekle, teslimat ucretsiz". Teslimat ZATEN ucretsizse (esik ya da
 * kargo kuponu) 0: kullaniciya gereksiz yere "daha ekle" denmesin.
 */
export function amountToFreeDelivery(
  subtotalMinor: number,
  deliveryFeeMinor: number,
  rules: PricingRules,
): number {
  return deliveryFeeMinor === 0 ? 0 : clampToZero(rules.freeDeliveryThresholdMinor - subtotalMinor);
}
