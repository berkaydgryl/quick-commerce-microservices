/**
 * Kilidi dusmus siparisin kapatilmasi: karar TEK yerde (T15.3; bekleyen is 122).
 * Iki yol ayni tabloyu uygular: supurucu (sweep-expired-reservations.ts, T11.2
 * PR 2) ve odeme ya da 3DS denemesinde kilidi dusmus bulan saga (lock-timing.ts).
 *
 *   DRAFT            -> odeme olamaz, kayda BAKILMAZ; CANCELLED, kilit birakilir
 *   AWAITING_PAYMENT -> once odeme kaydina bakilir (payment-standing.ts):
 *     para alinmis   -> CANCELLED + iade KOMUTU ayni yazimda, kilit birakilir,
 *                       sonra dogrudan iade denenir (hizli yol)
 *     cekim suruyor  -> HICBIR SEY yazilmaz (sonucu payment verecek)
 *     para alinmamis -> CANCELLED, kilit birakilir (3DS bekleyen dahil)
 *   payment-svc'ye ulasilamazsa hata yukari gider, hicbir sey yazilmaz.
 *
 * Iade komutu (payment.refund_requested) siparisle AYNI transaction'dadir:
 * servis iptalden hemen sonra cokse de komut kaybolmaz. Dogrudan iade basarili
 * olsa da komut payment-svc'ye ulasir; sabit anahtar (refund-<orderId>) ve
 * odemenin durumu ikinci iadeyi onler ("zaten iade edilmis").
 *
 * Sira: once siparis yazilir (surum kontrollu), sonra kilit ve iade. Siparisi o
 * arada baska bir yazim degistirdiyse (CONFLICT) dokunulmaz.
 */

import { ERROR_CODES, isAppError, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import { REFUND_REASON, refundIdempotencyKey } from '../domain/checkout-payment.js';
import type { PaymentStatus } from '../domain/checkout-payment.js';
import { refundRequestedEvent, statusChangedEvents } from '../domain/order-events.js';
import type { RefundRequest } from '../domain/order-events.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { transitionOrder } from '../domain/order.js';
import { PAYMENT_STANDING, paymentStandingOf } from '../domain/payment-standing.js';
import { RELEASE_REASON } from '../domain/stock-reservation.js';
import type { Payments } from './payments.js';
import type { RequestScope } from './request-scope.js';
import { releaseStock } from './stock-step.js';
import type { StockStepDeps } from './stock-step.js';

export interface LapseDeps extends StockStepDeps {
  readonly repository: Pick<OrderRepository, 'update'>;
  readonly payments: Pick<Payments, 'getPayment' | 'refund'>;
  readonly clock: Clock;
}

/**
 * Kapatmanin sonucu:
 *   closed    - CANCELLED yazildi, kilit birakildi (para alinmamisti);
 *   refunded  - CANCELLED ve iade komutu yazildi, kilit birakildi;
 *   in-flight - kart cekimi suruyor, HICBIR SEY yazilmadi;
 *   conflict  - siparis o arada degisti, dokunulmadi.
 */
export type LapseOutcome =
  | { readonly kind: 'closed' }
  | { readonly kind: 'refunded' }
  | { readonly kind: 'in-flight'; readonly paymentStatus: PaymentStatus }
  | { readonly kind: 'conflict' };

/**
 * Kilidi dusmus siparisi tabloya gore kapatir.
 * @throws payment-svc'ye ulasilamazsa getPayment'in hatasi (hicbir sey yazilmaz).
 */
export async function closeLapsedOrder(
  deps: LapseDeps,
  order: Order,
  scope: RequestScope,
): Promise<LapseOutcome> {
  let refund: RefundRequest | undefined;
  if (order.status !== ORDER_STATUS.DRAFT) {
    const payment = await deps.payments.getPayment(order.id, scope);
    const standing = paymentStandingOf(payment);
    if (payment !== null && standing === PAYMENT_STANDING.IN_FLIGHT) {
      return { kind: 'in-flight', paymentStatus: payment.status };
    }
    if (standing === PAYMENT_STANDING.CHARGED) {
      refund = {
        reason: REFUND_REASON.RESERVATION_EXPIRED,
        idempotencyKey: refundIdempotencyKey(order.id),
      };
    }
  }
  if (!(await cancelLapsed(deps, order, refund, scope))) {
    return { kind: 'conflict' };
  }
  if (refund === undefined) {
    return { kind: 'closed' };
  }
  await refundNow(deps, order, refund, scope);
  return { kind: 'refunded' };
}

/**
 * Siparisi CANCELLED (RESERVATION_EXPIRED) yazar - para alinmissa iade komutu
 * ayni yazimda - sonra kilidi birakir.
 * @returns yazildi mi? (false: surum cakismasi, siparis baska yolda ilerledi)
 */
async function cancelLapsed(
  deps: LapseDeps,
  order: Order,
  refund: RefundRequest | undefined,
  scope: RequestScope,
): Promise<boolean> {
  const cancelled = transitionOrder(
    order,
    ORDER_STATUS.CANCELLED,
    deps.clock,
    ERROR_CODES.RESERVATION_EXPIRED,
  );
  const statusEvents = statusChangedEvents(order, cancelled);
  const events =
    refund === undefined
      ? statusEvents
      : [...statusEvents, refundRequestedEvent(cancelled, refund, deps.clock.date())];
  try {
    await deps.repository.update(cancelled, order.version, events);
  } catch (error: unknown) {
    if (isAppError(error) && error.code === ERROR_CODES.CONFLICT) {
      return false;
    }
    throw error;
  }
  scope.logger.info(
    { orderId: order.id, from: order.status, charged: refund !== undefined },
    'kilidi dolan siparis kapatildi',
  );
  await releaseStock(deps, order, RELEASE_REASON.RESERVATION_EXPIRED, scope);
  return true;
}

/**
 * Hizli yol: iade komutu zaten kalici; dogrudan iade parayi beklemeden geri
 * verir. Basarisizsa komut payment-svc'de islenir (T7.4), burada yalniz WARN.
 */
async function refundNow(
  deps: LapseDeps,
  order: Order,
  refund: RefundRequest,
  scope: RequestScope,
): Promise<void> {
  try {
    await deps.payments.refund({ orderId: order.id, ...refund }, scope);
    scope.logger.warn(
      { orderId: order.id, reason: refund.reason },
      'kilidi dusmus siparisin alinan tutari iade edildi',
    );
  } catch (refundError: unknown) {
    scope.logger.warn(
      { err: refundError, orderId: order.id },
      'dogrudan iade basarisiz; iade komutu siparisle birlikte yazilmisti (payment.refund_requested)',
    );
  }
}
