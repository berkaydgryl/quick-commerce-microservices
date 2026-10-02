/**
 * Saga'nin telafi adimi: alinan tutarin iadesi (T7.1, T7.3). Odeme adimi
 * (payment-step.ts) ve kilidi dolan siparisleri kapatan supurucu (T11.2 PR 2)
 * ayni yolu kullanir.
 */

import type { Clock } from '@getir/core';

import { refundIdempotencyKey } from '../domain/checkout-payment.js';
import type { RefundReason } from '../domain/checkout-payment.js';
import { refundRequestedEvent } from '../domain/order-events.js';
import type { OrderOutbox } from '../domain/order-outbox.js';
import type { Order } from '../domain/order.js';
import type { Payments } from './payments.js';
import type { RequestScope } from './request-scope.js';

export interface RefundStepDeps {
  readonly payments: Pick<Payments, 'refund'>;
  /** Telafi komutu (T7.3): dogrudan iade basarisizsa kalici olarak yazilir. */
  readonly outbox: Pick<OrderOutbox, 'append'>;
  readonly clock: Clock;
}

/**
 * Telafi: alinan tutari geri verir. Once dogrudan iade denenir (hizli yol).
 * O da basarisiz olursa iade KOMUTU outbox'a yazilir (T7.3):
 * payment.refund_requested, payment-svc dinler ve ayni anahtarla iade eder
 * (T7.4) - komut kalicidir, servis yeniden baslasa da kaybolmaz. Istemciye her
 * durumda siparisin kendi hatasi doner (CONFLICT ya da RESERVATION_EXPIRED).
 */
export async function refundCharge(
  deps: RefundStepDeps,
  order: Order,
  reason: RefundReason,
  scope: RequestScope,
): Promise<void> {
  const request = { reason, idempotencyKey: refundIdempotencyKey(order.id) };
  try {
    await deps.payments.refund({ orderId: order.id, ...request }, scope);
    scope.logger.warn(
      { orderId: order.id, reason },
      'odeme alindi ama siparis tamamlanamadi; tutar iade edildi',
    );
  } catch (refundError: unknown) {
    await requestRefundLater(deps, order, request, refundError, scope);
  }
}

/** Dogrudan iade olmadi: komut outbox'a. O da yazilamazsa son care ERROR gunlugu. */
async function requestRefundLater(
  deps: RefundStepDeps,
  order: Order,
  request: { readonly reason: string; readonly idempotencyKey: string },
  refundError: unknown,
  scope: RequestScope,
): Promise<void> {
  try {
    await deps.outbox.append([refundRequestedEvent(order, request, deps.clock.date())]);
    scope.logger.warn(
      { err: refundError, orderId: order.id },
      'dogrudan iade basarisiz; iade komutu outbox a yazildi (payment.refund_requested)',
    );
  } catch (outboxError: unknown) {
    scope.logger.error(
      { err: outboxError, refundError, orderId: order.id },
      'TELAFI BASARISIZ: odeme alindi, siparis yazilamadi, iade ve iade komutu yazilamadi',
    );
  }
}
