/**
 * Sepet toplami - web (T6.4) ve order-service (T7.2) AYNI fonksiyonu cagirir.
 * Iki yerde ayri hesap, iki farkli toplam demektir: ekranda gorulen ile odenen
 * tutmazsa siparis PRICE_CHANGED ile reddedilir.
 *
 * HESAP SIRASI SABITTIR (roadmap B12):
 *   1. ara toplam
 *   2. urun indirimi (ILK10)          - ara toplamdan
 *   3. teslimat ucreti                - esik INDIRIM ONCESI ara toplama bakar
 *   4. kargo kuponu (KARGOBEDAVA)     - teslimati sifirlar
 *   5. max(0, toplam)
 * Esik indirimden once olculdugu icin kargo kuponu ile esik ustu sepet cift
 * indirim uretemez: teslimat zaten 0 ise kupon ikinci kez dusemez.
 *
 * Minimum sepet de ara toplama bakar: kupon, sepeti minimumun altina dusurup
 * siparisi engellemesin.
 */

import { evaluateCoupon } from './campaigns.js';
import { amountToFreeDelivery, amountToMinBasket, deliveryFeeFor } from './delivery-fee.js';
import { assertMinor, clampToZero } from './money.js';
import { calculateSubtotal } from './subtotal.js';
import type { CartInput, CartTotals, CouponOutcome } from './types.js';

export function calculateCart(input: CartInput): CartTotals {
  assertRules(input);

  const subtotalMinor = calculateSubtotal(input.lines);
  const coupon = evaluateInputCoupon(input, subtotalMinor);

  const discountMinor =
    coupon?.applied === true && coupon.effect.kind === 'PRODUCT_DISCOUNT'
      ? coupon.effect.discountMinor
      : 0;
  const baseFeeMinor = deliveryFeeFor(subtotalMinor, input.rules);
  const deliveryFeeMinor =
    coupon?.applied === true && coupon.effect.kind === 'FREE_SHIPPING' ? 0 : baseFeeMinor;

  return {
    subtotalMinor,
    discountMinor,
    deliveryFeeMinor,
    totalMinor: clampToZero(subtotalMinor - discountMinor + deliveryFeeMinor),
    canCheckout: input.lines.length > 0 && subtotalMinor >= input.rules.minBasketMinor,
    amountToMinBasketMinor: amountToMinBasket(subtotalMinor, input.rules),
    amountToFreeDeliveryMinor: amountToFreeDelivery(subtotalMinor, deliveryFeeMinor, input.rules),
    coupon: coupon === null ? null : toOutcome(coupon.code, coupon),
  };
}

type EvaluatedCoupon = ReturnType<typeof evaluateCoupon> & { readonly code: string };

function evaluateInputCoupon(input: CartInput, subtotalMinor: number): EvaluatedCoupon | null {
  const code = input.couponCode?.trim() ?? '';
  if (code === '') {
    return null;
  }
  return { ...evaluateCoupon(code, subtotalMinor, input.context), code };
}

function toOutcome(code: string, coupon: EvaluatedCoupon): CouponOutcome {
  return coupon.applied ? { code, applied: true } : { code, applied: false, reason: coupon.reason };
}

/** Kurallar marketin kaydindan gelir; bozuk kural programci/veri hatasidir. */
function assertRules({ rules }: CartInput): void {
  assertMinor(rules.minBasketMinor, 'minBasketMinor');
  assertMinor(rules.deliveryFeeMinor, 'deliveryFeeMinor');
  assertMinor(rules.freeDeliveryThresholdMinor, 'freeDeliveryThresholdMinor');
}
