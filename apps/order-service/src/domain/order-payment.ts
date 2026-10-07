/**
 * Siparisin odeme secimi (T12.4): yontem ve kapida odemenin turu (nakit ya da
 * kuryenin POS cihazi). Kurye kapida neyle tahsil edecegini buradan bilir;
 * teslimde tahsilat kaydi henuz yok (T13.3). Kisisel veri degildir.
 *
 * Risk adiminin yaziminda siparise girer (ayrintiyla birlikte). Odeme bekleyen
 * siparisin tekrar denemesinde secim DEGISEMEZ: cekimi degistirir (CONFLICT).
 * Ayrinti farki ise sessizce yok sayilir (order-details.ts).
 */

import { AppError, ERROR_CODES } from '@getir/core';

import { PAYMENT_METHOD } from './checkout-payment.js';
import type { PaymentMethod } from './checkout-payment.js';
import type { Order } from './order.js';

/** Kapida odemenin turu (proto DeliveryPaymentKind). */
export const DELIVERY_PAYMENT_KIND = {
  CASH: 'CASH',
  POS: 'POS',
} as const;

export type DeliveryPaymentKind =
  (typeof DELIVERY_PAYMENT_KIND)[keyof typeof DELIVERY_PAYMENT_KIND];

export interface OrderPayment {
  readonly method: PaymentMethod;
  /** Yalnizca kapida odemede (gRPC semasi zorunlu tutar). */
  readonly onDelivery?: DeliveryPaymentKind | undefined;
}

/** Yazilacak secim: kartta tur tasinmaz. */
export function paymentChoiceOf(
  method: PaymentMethod,
  onDelivery?: DeliveryPaymentKind,
): OrderPayment {
  return method === PAYMENT_METHOD.CASH_ON_DELIVERY && onDelivery !== undefined
    ? { method, onDelivery }
    : { method };
}

/**
 * Odeme bekleyen siparisin tekrarinda secim kayitlidan farkliysa CONFLICT
 * (ayrintida degisen alan). Secimi kayitli olmayan (bu alandan once verilmis)
 * sipariste denetim yok.
 *
 * @throws AppError CONFLICT - yontem ya da kapida odemenin turu degismis.
 */
export function assertSamePayment(order: Order, choice: OrderPayment): void {
  const recorded = order.payment;
  if (recorded === undefined) {
    return;
  }
  const field =
    recorded.method !== choice.method
      ? 'paymentMethod'
      : recorded.onDelivery !== choice.onDelivery
        ? 'onDelivery'
        : undefined;
  if (field !== undefined) {
    throw new AppError(ERROR_CODES.CONFLICT, 'Odeme secimi bu sipariste degistirilemez', {
      details: { orderId: order.id, field },
    });
  }
}
