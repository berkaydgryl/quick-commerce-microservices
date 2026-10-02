/**
 * Odeme bekleyen siparisin odemesi nerede (T11.2 PR 2): saf kural.
 *
 * Sipariste para tutulmaz; payment-svc'nin kaydina bakilir (GetPayment).
 * Kullanici iptali ve supurucu ayni soruyu sorar: "bu siparis icin para alindi
 * mi, alinmak uzere mi?" Para alinmissa siparis sessizce kapatilamaz.
 */

import { PAYMENT_METHOD, PAYMENT_STATUS } from './checkout-payment.js';
import type { PaymentMethod, PaymentStatus } from './checkout-payment.js';

/** payment-svc kaydinin siparis icin anlamli kismi. */
export interface PaymentSnapshot {
  readonly status: PaymentStatus;
  readonly method: PaymentMethod;
}

export const PAYMENT_STANDING = {
  /** Kart cekimi tamamlandi: para alindi. */
  CHARGED: 'charged',
  /** Kart cekimi suruyor (PENDING): sonucu belli degil. */
  IN_FLIGHT: 'in-flight',
  /** Para alinmadi: kayit yok, 3DS bekliyor, basarisiz, iade edildi ya da kapida odeme. */
  NONE: 'none',
} as const;

export type PaymentStanding = (typeof PAYMENT_STANDING)[keyof typeof PAYMENT_STANDING];

/**
 * Kapida odemenin PENDING'i "cekim suruyor" DEGILDIR: tutar teslimatta alinir,
 * kayit o ana kadar PENDING kalir.
 */
export function paymentStandingOf(snapshot: PaymentSnapshot | null): PaymentStanding {
  if (snapshot === null) {
    return PAYMENT_STANDING.NONE;
  }
  if (snapshot.status === PAYMENT_STATUS.SUCCEEDED) {
    return PAYMENT_STANDING.CHARGED;
  }
  if (snapshot.status === PAYMENT_STATUS.PENDING && snapshot.method === PAYMENT_METHOD.CARD) {
    return PAYMENT_STANDING.IN_FLIGHT;
  }
  return PAYMENT_STANDING.NONE;
}
