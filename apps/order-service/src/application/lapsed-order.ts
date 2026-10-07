/**
 * Kilidi dusmus siparisin kapatilmasi: karar TEK yerde (T15.3; bekleyen is 122).
 * Iki yol ayni tabloyu uygular: supurucu (sweep-expired-reservations.ts, T11.2
 * PR 2) ve odeme ya da 3DS denemesinde kilidi dusmus bulan saga (lock-timing.ts).
 *
 *   DRAFT            -> odeme olamaz, kayda BAKILMAZ; CANCELLED, kilit birakilir
 *   AWAITING_PAYMENT -> once odeme kaydina bakilir (payment-standing.ts):
 *     para alinmis   -> once Commit (bekleyen is 124):
 *       kesinlesti   -> PAID (onceki deneme kesinlestirmis ya da sure gecmis
 *                       ama kilit henuz birakilmamis); iade YOK
 *       kilit yok    -> CANCELLED + iade KOMUTU ayni yazimda, kilit birakilir,
 *                       sonra dogrudan iade denenir (hizli yol)
 *     cekim suruyor  -> HICBIR SEY yazilmaz (sonucu payment verecek)
 *     para alinmamis -> CANCELLED, kilit birakilir (3DS bekleyen dahil)
 *   payment-svc ya da inventory'ye ulasilamazsa hata yukari gider, hicbir sey
 *   yazilmaz.
 *
 * Neden Commit: inventory, kesinlesmis kilidin uzatma ve kisaltmasina da
 * RESERVATION_EXPIRED doner. Commit ise kesinlesmis kilidi taniyip
 * ALREADY_APPLIED der; satilmis stokla siparis iptal edilip iade edilmez.
 *
 * Iade komutu (payment.refund_requested) siparisle AYNI transaction'dadir:
 * servis iptalden hemen sonra cokse de komut kaybolmaz. Dogrudan iade basarili
 * olsa da komut payment-svc'ye ulasir; sabit anahtar (refund-<orderId>) ve
 * odemenin durumu ikinci iadeyi onler ("zaten iade edilmis").
 *
 * Sira: once siparis yazilir (surum kontrollu), sonra kilit ve iade. Siparisi o
 * arada baska bir yazim degistirdiyse (CONFLICT) dokunulmaz; tek istisna para:
 * alinmissa ve siparisi baska yol IPTAL ettiyse (kullanici iptali ya da odemeyi
 * henuz gormemis bir kapatma) iade yine yapilir - dogrudan, olmazsa outbox komutu
 * (refund-step.ts). Sabit anahtar ikinci iadeyi onler.
 */

import { ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import { REFUND_REASON, refundIdempotencyKey } from '../domain/checkout-payment.js';
import type { PaymentStatus, RefundReason } from '../domain/checkout-payment.js';
import { refundRequestedEvent, statusChangedEvents } from '../domain/order-events.js';
import type { RefundRequest } from '../domain/order-events.js';
import type { Order } from '../domain/order.js';
import { transitionOrder } from '../domain/order.js';
import { PAYMENT_STANDING, paymentStandingOf } from '../domain/payment-standing.js';
import { RELEASE_REASON } from '../domain/stock-reservation.js';
import { isConflict, paidOrder, tryWriteTransition } from './order-transition.js';
import type { TransitionRepository } from './order-transition.js';
import type { Payments } from './payments.js';
import { refundCharge } from './refund-step.js';
import type { RefundStepDeps } from './refund-step.js';
import type { RequestScope } from './request-scope.js';
import { SETTLEMENT } from './stock-reservations.js';
import { commitStock, releaseStock } from './stock-step.js';
import type { StockStepDeps } from './stock-step.js';

export interface LapseDeps extends StockStepDeps, RefundStepDeps {
  /** findById: yazim cakisirsa siparisin son hali (order-transition.ts). */
  readonly repository: TransitionRepository;
  readonly payments: Pick<Payments, 'getPayment' | 'refund'>;
  readonly clock: Clock;
}

/** Stoksuz kapatmanin sonucu: CANCELLED yazildi (iadeli ya da iadesiz) ya da cakisti. */
export type StocklessClose =
  { readonly kind: 'closed' } | { readonly kind: 'refunded' } | { readonly kind: 'conflict' };

/**
 * Kapatmanin sonucu:
 *   closed    - CANCELLED yazildi, kilit birakildi (para alinmamisti);
 *   refunded  - CANCELLED ve iade komutu yazildi, kilit birakildi;
 *   paid      - para alinmis, stok kesinlesmis: siparis PAID (bekleyen is 124);
 *               recovered: PAID'i bu cagri yazdi (false: baska yol yazmisti);
 *   in-flight - kart cekimi suruyor, HICBIR SEY yazilmadi;
 *   conflict  - siparis o arada degisti, dokunulmadi.
 */
export type LapseOutcome =
  | StocklessClose
  | { readonly kind: 'paid'; readonly order: Order; readonly recovered: boolean }
  | { readonly kind: 'in-flight'; readonly paymentStatus: PaymentStatus };

/**
 * Kilidi dusmus siparisi tabloya gore kapatir.
 * @throws payment-svc ya da inventory'ye ulasilamazsa hatasi (hicbir sey yazilmaz).
 */
export async function closeLapsedOrder(
  deps: LapseDeps,
  order: Order,
  scope: RequestScope,
): Promise<LapseOutcome> {
  if (order.status === ORDER_STATUS.DRAFT) {
    return closeWithoutStock(deps, order, false, scope);
  }
  const payment = await deps.payments.getPayment(order.id, scope);
  const standing = paymentStandingOf(payment);
  if (payment !== null && standing === PAYMENT_STANDING.IN_FLIGHT) {
    return { kind: 'in-flight', paymentStatus: payment.status };
  }
  if (standing !== PAYMENT_STANDING.CHARGED) {
    return closeWithoutStock(deps, order, false, scope);
  }
  return completeOrRefund(deps, order, scope);
}

/**
 * Kilitsiz kapatma: CANCELLED (RESERVATION_EXPIRED), para alinmissa iade komutu
 * ayni yazimda; sonra kilit birakilir ve dogrudan iade denenir. Odeme adimi da
 * kullanir: Commit kilidi bulamadiysa (payment-step.ts).
 */
export async function closeWithoutStock(
  deps: LapseDeps,
  order: Order,
  charged: boolean,
  scope: RequestScope,
): Promise<StocklessClose> {
  const refund: RefundRequest | undefined = charged
    ? { reason: REFUND_REASON.RESERVATION_EXPIRED, idempotencyKey: refundIdempotencyKey(order.id) }
    : undefined;
  if (!(await cancelLapsed(deps, order, refund, scope))) {
    if (refund !== undefined) {
      const latest = await deps.repository.findById(order.id);
      await refundIfCancelledElsewhere(
        deps,
        order,
        latest,
        REFUND_REASON.RESERVATION_EXPIRED,
        scope,
      );
    }
    return { kind: 'conflict' };
  }
  if (refund === undefined) {
    return { kind: 'closed' };
  }
  await refundNow(deps, order, refund, scope);
  return { kind: 'refunded' };
}

/**
 * Para alinmis: kilit "dusmus" gorunse de ilk deneme kesinlestirmis olabilir.
 * Commit yoklar: kesinlestiyse PAID, kilit yoksa iptal ve iade.
 */
async function completeOrRefund(
  deps: LapseDeps,
  order: Order,
  scope: RequestScope,
): Promise<LapseOutcome> {
  const settlement = await commitStock(deps, order, scope);
  if (settlement === SETTLEMENT.NOT_FOUND) {
    return closeWithoutStock(deps, order, true, scope);
  }
  const write = await tryWriteTransition(
    deps.repository,
    order,
    paidOrder(order, deps.clock, undefined),
  );
  if (write.written) {
    scope.logger.warn(
      { orderId: order.id, settlement },
      'kilidi dusmus gorunen siparisin stogu kesinlesmisti; odeme alinmis, siparis PAID',
    );
    return { kind: 'paid', order: write.order, recovered: true };
  }
  if (write.latest?.status === ORDER_STATUS.PAID) {
    // Ayni odemenin es zamanli tekrari PAID yazmis: sonuc ayni, sayilmaz.
    return { kind: 'paid', order: write.latest, recovered: false };
  }
  await refundIfCancelledElsewhere(
    deps,
    order,
    write.latest,
    REFUND_REASON.ORDER_CHANGED_DURING_PAYMENT,
    scope,
  );
  return { kind: 'conflict' };
}

/**
 * Yazim cakisti ama para alinmisti. Siparisi baska yol IPTAL ettiyse iade
 * komutu yazilmamis olabilir (kullanici iptali ya da odemeyi henuz gormemis
 * kapatma): iade burada yapilir. Siparis hala aciksa (yalniz surum artmis) ya da
 * PAID ise dokunulmaz: karari o yol ya da supurucu verir.
 */
async function refundIfCancelledElsewhere(
  deps: LapseDeps,
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
    if (isConflict(error)) {
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
