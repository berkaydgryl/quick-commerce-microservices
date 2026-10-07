/**
 * Odeme secimi (F12; T12.4 sozlesmesi): kasadaki kart ya da kapida odeme
 * (nakit ya da kuryenin POS cihazindan kart). Sayfanin durumu tek secim tutar;
 * siparis govdesine sozlesmenin bicimiyle cevrilir. Govdede kart verisi YOK
 * (M7): yalnizca kartin kimligi.
 */

import type { DeliveryPaymentKind, OrderPaymentInput } from '@getir/contracts';

export type PaymentChoice =
  | { readonly kind: 'card'; readonly cardId: string }
  | { readonly kind: 'onDelivery'; readonly onDelivery: DeliveryPaymentKind };

/** Siparis govdesinin odeme alani: kartta cardId, kapida odemede tur (kart alani yok). */
export function paymentInput(choice: PaymentChoice): OrderPaymentInput {
  return choice.kind === 'card'
    ? { method: 'CARD', cardId: choice.cardId }
    : { method: 'CASH_ON_DELIVERY', onDelivery: choice.onDelivery };
}

/**
 * Sayfadaki secim: kapida odeme secildiyse o; degilse uygulanan kart (en yeni
 * gecerli kart ya da secilen, F5); ikisi de yoksa secim yok (PM S2 (a)).
 */
export function effectivePayment(
  onDelivery: DeliveryPaymentKind | undefined,
  cardId: string | undefined,
): PaymentChoice | undefined {
  if (onDelivery !== undefined) {
    return { kind: 'onDelivery', onDelivery };
  }
  return cardId === undefined ? undefined : { kind: 'card', cardId };
}
