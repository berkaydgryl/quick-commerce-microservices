/**
 * Saga'nin telafi adimi: alinan tutarin iadesi (T7.1, T7.3); odeme adimi
 * (payment-step.ts) kullanir. Kilidi dusmus siparisi KENDISI iptal eden yol bu
 * yoldan gitmez: iade komutu iptalle ayni yazimda (stockless-close.ts, T15.3).
 * Siparisi baska yol iptal ettiyse ve para alinmissa kapatma da burayi
 * kullanir (refundIfCancelledElsewhere; bekleyen is 124).
 *
 * Iade dogrudan yapildiysa ya da komutu yazildiysa iptal edilmis siparise kalici
 * iade isareti yazilir (#166, refund-record.ts): siparis gecmiste kalir. Ikisi de
 * olmadiysa (son care ERROR) isaret yazilmaz: iade edilmemis para "iade edildi"
 * gorunmesin.
 */

import { ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import { refundIdempotencyKey } from '../domain/checkout-payment.js';
import type { RefundReason } from '../domain/checkout-payment.js';
import { refundRequestedEvent } from '../domain/order-events.js';
import type { OrderOutbox } from '../domain/order-outbox.js';
import type { Order } from '../domain/order.js';
import type { Payments } from './payments.js';
import { recordRefund } from './refund-record.js';
import type { RefundRecordDeps } from './refund-record.js';
import type { RequestScope } from './request-scope.js';

export interface RefundStepDeps extends RefundRecordDeps {
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
  let initiated: boolean;
  try {
    await deps.payments.refund({ orderId: order.id, ...request }, scope);
    scope.logger.warn(
      { orderId: order.id, reason },
      'odeme alindi ama siparis tamamlanamadi; tutar iade edildi',
    );
    initiated = true;
  } catch (refundError: unknown) {
    initiated = await requestRefundLater(deps, order, request, refundError, scope);
  }
  if (initiated) {
    await recordRefund(deps, order.id, reason, scope);
  }
}

/**
 * Yazim cakisti ama para alinmisti. Siparisi baska yol IPTAL ettiyse iade
 * komutu yazilmamis olabilir (kullanici iptali ya da odemeyi henuz gormemis
 * kapatma): iade burada yapilir. Siparis hala aciksa (yalniz surum artmis) ya da
 * PAID ise dokunulmaz: karari o yol ya da supurucu verir.
 */
export async function refundIfCancelledElsewhere(
  deps: RefundStepDeps,
  order: Order,
  latest: Order | null,
  reason: RefundReason,
  scope: RequestScope,
): Promise<void> {
  if (latest?.status !== ORDER_STATUS.CANCELLED) {
    return;
  }
  scope.logger.warn(
    { orderId: order.id, reason },
    'siparisi baska yol iptal etti ama odeme alinmisti; tutar iade ediliyor',
  );
  await refundCharge(deps, order, reason, scope);
}

/**
 * Dogrudan iade olmadi: komut outbox'a. O da yazilamazsa son care ERROR gunlugu.
 * @returns komut yazildi mi?
 */
async function requestRefundLater(
  deps: RefundStepDeps,
  order: Order,
  request: { readonly reason: string; readonly idempotencyKey: string },
  refundError: unknown,
  scope: RequestScope,
): Promise<boolean> {
  try {
    await deps.outbox.append([refundRequestedEvent(order, request, deps.clock.date())]);
    scope.logger.warn(
      { err: refundError, orderId: order.id },
      'dogrudan iade basarisiz; iade komutu outbox a yazildi (payment.refund_requested)',
    );
    return true;
  } catch (outboxError: unknown) {
    scope.logger.error(
      { err: outboxError, refundError, orderId: order.id },
      'TELAFI BASARISIZ: odeme alindi, siparis yazilamadi, iade ve iade komutu yazilamadi',
    );
    return false;
  }
}
