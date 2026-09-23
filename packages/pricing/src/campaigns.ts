/**
 * Kupon katalogu (sade tutulur): veritabani tablosu, kullanim sayisi takibi ve
 * tarih araligi yonetimi KAPSAM DISI (roadmap "Kupon mekanizmasi").
 *
 * Kupon iki turdur ve hesaptaki YERI farklidir (B12 sirasi):
 *   - urun indirimi (ILK10)  -> ara toplamdan duser, teslimattan ONCE
 *   - kargo kuponu (KARGOBEDAVA) -> teslimat ucretini sifirlar, teslimattan SONRA
 * Bu yuzden kupon "ne kadar indirim" degil "hangi adimda ne yapar" olarak
 * tanimlanir.
 */

import {
  BASIS_POINTS,
  FIRST_ORDER_DISCOUNT_BPS,
  FIRST_ORDER_DISCOUNT_CAP_MINOR,
  FREE_SHIPPING_COUPON_MIN_SUBTOTAL_MINOR,
} from './constants.js';
import type { CouponRejection, PricingContext } from './types.js';

export const COUPON_CODES = {
  FIRST_ORDER: 'ILK10',
  FREE_SHIPPING: 'KARGOBEDAVA',
} as const;

/** Kuponun hesaba etkisi. */
export type CouponEffect =
  | { readonly kind: 'PRODUCT_DISCOUNT'; readonly discountMinor: number }
  | { readonly kind: 'FREE_SHIPPING' };

export type CouponEvaluation =
  | { readonly applied: true; readonly effect: CouponEffect }
  | { readonly applied: false; readonly reason: CouponRejection };

/**
 * Kullanici girdisini karsilastirilabilir bicime getirir: " ilk10 " -> "ILK10".
 *
 * DIKKAT - toLocaleUpperCase('tr') DEGIL: Turkce kuralinda "i" -> "İ" olur ve
 * "ilk10" yazan kullanicinin kodu "İLK10" olup hic eslesmezdi. Kupon kodlari
 * ASCII'dir; yerel ayarsiz buyuk harf dogrudur.
 */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Kuponu ara toplama gore degerlendirir. Kosul ve tutar INDIRIM ONCESI ara
 * toplama bakar (B12).
 */
export function evaluateCoupon(
  code: string,
  subtotalMinor: number,
  context: PricingContext,
): CouponEvaluation {
  switch (normalizeCouponCode(code)) {
    case COUPON_CODES.FIRST_ORDER: {
      if (!context.isFirstOrder) {
        return { applied: false, reason: 'NOT_FIRST_ORDER' };
      }
      // Tam sayi aritmetigi: kurusun altina asagi yuvarlanir (kullanici
      // aleyhine degil, platform aleyhine en fazla 1 kurus).
      const percent = Math.floor((subtotalMinor * FIRST_ORDER_DISCOUNT_BPS) / BASIS_POINTS);
      return {
        applied: true,
        effect: {
          kind: 'PRODUCT_DISCOUNT',
          discountMinor: Math.min(percent, FIRST_ORDER_DISCOUNT_CAP_MINOR),
        },
      };
    }
    case COUPON_CODES.FREE_SHIPPING:
      return subtotalMinor >= FREE_SHIPPING_COUPON_MIN_SUBTOTAL_MINOR
        ? { applied: true, effect: { kind: 'FREE_SHIPPING' } }
        : { applied: false, reason: 'BELOW_MIN_SUBTOTAL' };
    default:
      return { applied: false, reason: 'UNKNOWN_CODE' };
  }
}
