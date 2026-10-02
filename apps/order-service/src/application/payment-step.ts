/**
 * Saga'nin odeme adimi (T7.1): cekim ve sonucun siparise islenmesi.
 * CreateOrder (cekim) ve ConfirmPayment (3DS onayi) ayni isleme yolunu kullanir.
 *
 * TELAFI: cekim basarili oldu ama siparis PAID yazilamadi (surum cakismasi -
 * ornegin kullanici tam o anda iptal etti) -> para GERI VERILIR, istemci
 * CONFLICT alir. Cakismanin sebebi ayni odemenin es zamanli ikinci istegiyse
 * (siparis zaten PAID) iade YAPILMAZ: kazanan istek siparisi odenmis yazmistir.
 *
 * STOK (T11.2): odeme alininca kilit PAID'den ONCE kesinlesir (Commit) - "odendi
 * ama stok kesinlesmedi" durumu olusmaz. Commit gecici hata verirse siparis odeme
 * bekler kalir; ayni istek tekrar gelince cekim idempotent ilk sonucu doner,
 * Commit yeniden denenir. Kilit o arada dustuyse para iade edilir, siparis
 * CANCELLED, istemci RESERVATION_EXPIRED alir. Kart reddinde kilit birakilir.
 */

import { AppError, ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock, ErrorCode } from '@getir/core';

import {
  chargeIdempotencyKey,
  decidePayment,
  PAYMENT_STATUS,
  REFUND_REASON,
  refundIdempotencyKey,
} from '../domain/checkout-payment.js';
import type { PaymentMethod, PaymentResult, RefundReason } from '../domain/checkout-payment.js';
import { assertPaymentMethodAllowed, paymentPolicyOf } from '../domain/checkout-risk.js';
import { refundRequestedEvent, statusChangedEvents } from '../domain/order-events.js';
import type { OrderOutbox } from '../domain/order-outbox.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { transitionOrder } from '../domain/order.js';
import { RELEASE_REASON } from '../domain/stock-reservation.js';
import type { Payments } from './payments.js';
import type { RequestScope } from './request-scope.js';
import { SETTLEMENT } from './stock-reservations.js';
import { commitStock, releaseStock } from './stock-step.js';
import type { StockStepDeps } from './stock-step.js';

export interface PaymentStepDeps extends StockStepDeps {
  readonly repository: Pick<OrderRepository, 'update' | 'findById'>;
  readonly payments: Payments;
  /** Telafi komutu (T7.3): dogrudan iade basarisizsa kalici olarak yazilir. */
  readonly outbox: Pick<OrderOutbox, 'append'>;
  readonly clock: Clock;
}

export interface CheckoutResult {
  readonly order: Order;
  /** Yalnizca 3DS bekleniyorsa dolu; istemci ConfirmPayment'a geri verir. */
  readonly challengeId?: string;
}

export interface PaymentChoice {
  readonly method: PaymentMethod;
  readonly cardToken?: string;
}

/** Odeme bekleyen siparisin tutarini ceker. Tekrar denemede ayni anahtar gider. */
export async function chargeOrder(
  deps: PaymentStepDeps,
  order: Order,
  choice: PaymentChoice,
  scope: RequestScope,
): Promise<CheckoutResult> {
  const policy = paymentPolicyOf(order);
  assertPaymentMethodAllowed(order.id, choice.method, policy);

  const result = await deps.payments.charge(
    {
      orderId: order.id,
      userId: order.userId,
      amountMinor: order.pricing.totalMinor,
      currency: order.pricing.currency,
      method: choice.method,
      ...(choice.cardToken === undefined ? {} : { cardToken: choice.cardToken }),
      idempotencyKey: chargeIdempotencyKey(order.id),
      requireThreeDs: policy.requireThreeDs,
    },
    scope,
  );
  return settleOrderPayment(deps, order, choice.method, result, scope);
}

/** Odeme sonucunu siparise isler: PAID, PAYMENT_FAILED ya da 3DS beklemesi. */
export async function settleOrderPayment(
  deps: PaymentStepDeps,
  order: Order,
  method: PaymentMethod,
  result: PaymentResult,
  scope: RequestScope,
): Promise<CheckoutResult> {
  const decision = decidePayment(order.id, method, result);
  switch (decision.kind) {
    case 'awaiting-3ds':
      return { order, challengeId: decision.challengeId };
    case 'failed':
      await failPayment(deps, order, decision.code, scope);
      throw new AppError(decision.code, 'Odeme alinamadi', {
        details: { orderId: order.id, status: ORDER_STATUS.PAYMENT_FAILED },
      });
    case 'paid':
      await commitPaidStock(deps, order, result, scope);
      return { order: await markPaid(deps, order, result, decision.note, scope) };
  }
}

/**
 * Siparisi PAYMENT_FAILED yazar (not: hata anahtari) ve stok kilidini birakir:
 * stok baskasina acilir (T11.2). Hatayi CAGIRAN firlatir: 3DS kapanisinda
 * payment-svc'nin kendi hatasi (kalan hak, sebep) istemciye aynen gitmeli.
 * Cekim YAPILMADI; para telafisi gerekmez.
 */
export async function failPayment(
  deps: PaymentStepDeps,
  order: Order,
  code: ErrorCode,
  scope: RequestScope,
): Promise<Order> {
  const failed = transitionOrder(order, ORDER_STATUS.PAYMENT_FAILED, deps.clock, code);
  const written = await writeTransition(deps.repository, order, failed);
  await releaseStock(deps, order, RELEASE_REASON.PAYMENT_FAILED, scope);
  return written;
}

/**
 * Odenen siparisin kilidini kesinlestirir. Kilit dusmusse (suresi dolup
 * supurucu birakmis): para iade edilir, siparis CANCELLED, RESERVATION_EXPIRED.
 * T11.2 oncesi acilmis, kilidi olmayan siparis kesinlestirilmez (gecis donemi).
 */
async function commitPaidStock(
  deps: PaymentStepDeps,
  order: Order,
  result: PaymentResult,
  scope: RequestScope,
): Promise<void> {
  if (order.reservation === undefined) {
    scope.logger.info(
      { orderId: order.id },
      'siparisin stok kilidi yok (T11.2 oncesi); kesinlestirme atlandi',
    );
    return;
  }
  const outcome = await commitStock(deps, order, scope);
  if (outcome !== SETTLEMENT.NOT_FOUND) {
    return;
  }
  const charged = result.status === PAYMENT_STATUS.SUCCEEDED;
  if (charged) {
    await refundCharge(deps, order, REFUND_REASON.RESERVATION_EXPIRED, scope);
  }
  const cancelled = transitionOrder(
    order,
    ORDER_STATUS.CANCELLED,
    deps.clock,
    ERROR_CODES.RESERVATION_EXPIRED,
  );
  await writeTransition(deps.repository, order, cancelled);
  scope.logger.warn(
    { orderId: order.id, refunded: charged },
    'stok kilidi odeme sirasinda dusmustu; siparis iptal edildi',
  );
  throw new AppError(ERROR_CODES.RESERVATION_EXPIRED, 'Rezervasyon suresi doldu', {
    details: { orderId: order.id, status: ORDER_STATUS.CANCELLED },
  });
}

async function markPaid(
  deps: PaymentStepDeps,
  order: Order,
  result: PaymentResult,
  note: string | undefined,
  scope: RequestScope,
): Promise<Order> {
  const paid = transitionOrder(order, ORDER_STATUS.PAID, deps.clock, note);
  try {
    return await writeTransition(deps.repository, order, paid);
  } catch (error) {
    if (isConflict(error) && result.status === PAYMENT_STATUS.SUCCEEDED) {
      await refundCharge(deps, order, REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT, scope);
    }
    throw error;
  }
}

/**
 * Surum kontrollu yazar. Cakismada kayit tekrar okunur: zaten hedef durumdaysa
 * (ayni istegin es zamanli tekrari yazdi) o kayit doner; degilse CONFLICT.
 */
async function writeTransition(
  repository: PaymentStepDeps['repository'],
  current: Order,
  next: Order,
): Promise<Order> {
  try {
    await repository.update(next, current.version, statusChangedEvents(current, next));
    return next;
  } catch (error) {
    if (!isConflict(error)) {
      throw error;
    }
    const latest = await repository.findById(current.id);
    if (latest?.status === next.status) {
      return latest;
    }
    throw error;
  }
}

/**
 * Telafi: alinan tutari geri verir. Once dogrudan iade denenir (hizli yol).
 * O da basarisiz olursa iade KOMUTU outbox'a yazilir (T7.3):
 * payment.refund_requested, payment-svc dinler ve ayni anahtarla iade eder
 * (T7.4) - komut kalicidir, servis yeniden baslasa da kaybolmaz. Istemciye her
 * durumda siparisin kendi hatasi doner (CONFLICT ya da RESERVATION_EXPIRED).
 */
async function refundCharge(
  deps: PaymentStepDeps,
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
  deps: PaymentStepDeps,
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

function isConflict(error: unknown): boolean {
  return error instanceof AppError && error.code === ERROR_CODES.CONFLICT;
}
