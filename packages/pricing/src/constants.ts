/**
 * Platform kampanya sabitleri (ADR-15: kuponlar platformundur, marketten
 * bagimsizdir). Tutarlar KURUS; yuzdeler BAZ PUAN (1000 = %10) - float yok.
 */

/** Baz puan tabani: 10_000 = %100. */
export const BASIS_POINTS = 10_000;

/** ILK10: ilk sipariste %10, en cok 30 TL. */
export const FIRST_ORDER_DISCOUNT_BPS = 1_000;
export const FIRST_ORDER_DISCOUNT_CAP_MINOR = 3_000;

/** KARGOBEDAVA: ara toplam 150 TL ve ustu. "150 TL uzeri" esik DAHIL okunur. */
export const FREE_SHIPPING_COUPON_MIN_SUBTOTAL_MINOR = 15_000;
