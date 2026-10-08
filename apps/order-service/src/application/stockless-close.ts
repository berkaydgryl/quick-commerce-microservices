/**
 * Kilitsiz kapatma: stok kilidi dusmus siparisi CANCELLED (RESERVATION_EXPIRED)
 * yazar. Iki yol kullanir: kilidi dusmus siparisin kapatilmasi (lapsed-order.ts;
 * supurucu ve odeme denemesi) ve odeme adimi (payment-step.ts: Commit kilidi
 * bulamadi).
 *
 * Paranin durumu TEK degerdir (CHARGE):
 *   NONE     - para alinmamis: yalniz CANCELLED, kilit birakilir
 *   TAKEN    - para alinmis: CANCELLED + iade KOMUTU + kalici iade isareti
 *              (#166) ayni yazimda, kilit birakilir, sonra dogrudan iade
 *              denenir (hizli yol)
 *   REFUNDED - para alinmis ve baska yolda zaten iade edilmis: komut yok,
 *              yalniz kalici iade isareti (gerekce payment_refunded)
 *
 * Iade komutu (payment.refund_requested) siparisle AYNI transaction'dadir:
 * servis iptalden hemen sonra cokse de komut kaybolmaz. Dogrudan iade basarili
 * olsa da komut payment-svc'ye ulasir; sabit anahtar (refund-<orderId>) ve
 * odemenin durumu ikinci iadeyi onler ("zaten iade edilmis").
 *
 * Siparisi o arada baska bir yazim degistirdiyse (CONFLICT) dokunulmaz; istisna
 * para: siparisi baska yol IPTAL ettiyse, alinmis para yine iade edilir
 * (refund-step.ts refundIfCancelledElsewhere), zaten iade edilmis paranin
 * isareti yine yazilir (refund-record.ts; #185 N4).
 */

import { ERROR_CODES, ORDER_STATUS } from '@getir/core';
import type { Clock } from '@getir/core';

import { REFUND_REASON, refundIdempotencyKey } from '../domain/checkout-payment.js';
import { refundRequestedEvent } from '../domain/order-events.js';
import type { RefundRequest } from '../domain/order-events.js';
import type { Order } from '../domain/order.js';
import { transitionOrder } from '../domain/order.js';
import { REFUND_MARK_REASON, withRefund } from '../domain/order-refund.js';
import { RELEASE_REASON } from '../domain/stock-reservation.js';
import { tryWriteTransition } from './order-transition.js';
import type { TransitionRepository, TransitionWrite } from './order-transition.js';
import type { Payments } from './payments.js';
import { recordRefund } from './refund-record.js';
import { refundIfCancelledElsewhere } from './refund-step.js';
import type { RefundStepDeps } from './refund-step.js';
import type { RequestScope } from './request-scope.js';
import { releaseStock } from './stock-step.js';
import type { StockStepDeps } from './stock-step.js';

/** Kapatilan siparisin parasi: alinmadi, alindi ya da baska yolda iade edildi. */
export const CHARGE = {
  NONE: 'none',
  TAKEN: 'taken',
  REFUNDED: 'refunded',
} as const;

export type Charge = (typeof CHARGE)[keyof typeof CHARGE];

export interface StocklessCloseDeps extends StockStepDeps, RefundStepDeps {
  /** findById: yazim cakisirsa siparisin son hali (order-transition.ts). */
  readonly repository: TransitionRepository;
  readonly payments: Pick<Payments, 'refund'>;
  readonly clock: Clock;
}

/** Stoksuz kapatmanin sonucu: CANCELLED yazildi (iadeli ya da iadesiz) ya da cakisti. */
export type StocklessClose =
  { readonly kind: 'closed' } | { readonly kind: 'refunded' } | { readonly kind: 'conflict' };

/**
 * Kilitsiz kapatma: CANCELLED (RESERVATION_EXPIRED); para alinmissa iade komutu
 * ve isaret ayni yazimda, sonra kilit birakilir ve dogrudan iade denenir.
 */
export async function closeWithoutStock(
  deps: StocklessCloseDeps,
  order: Order,
  charge: Charge,
  scope: RequestScope,
): Promise<StocklessClose> {
  const refund: RefundRequest | undefined =
    charge === CHARGE.TAKEN
      ? {
          reason: REFUND_REASON.RESERVATION_EXPIRED,
          idempotencyKey: refundIdempotencyKey(order.id),
        }
      : undefined;
  const write = await cancelLapsed(deps, order, refund, charge, scope);
  if (!write.written) {
    await settleConflict(deps, order, write.latest, charge, scope);
    return { kind: 'conflict' };
  }
  if (refund === undefined) {
    return { kind: 'closed' };
  }
  await refundNow(deps, order, refund, scope);
  return { kind: 'refunded' };
}

/**
 * Kapatma cakisti: siparisi baska yol degistirdi. Para alinmissa iade, para
 * zaten iade edilmisse isaret; ikisi de yalniz siparis baska yolda IPTAL
 * edildiyse. Siparis hala aciksa dokunulmaz (karari o yol ya da supurucu verir).
 */
async function settleConflict(
  deps: StocklessCloseDeps,
  order: Order,
  latest: Order | null,
  charge: Charge,
  scope: RequestScope,
): Promise<void> {
  if (charge === CHARGE.TAKEN) {
    await refundIfCancelledElsewhere(deps, order, latest, REFUND_REASON.RESERVATION_EXPIRED, scope);
    return;
  }
  if (charge === CHARGE.REFUNDED && latest?.status === ORDER_STATUS.CANCELLED) {
    // Iade baska yolda yapildi; isareti yalniz siparisin iptalini yazan yol
    // yazabilirdi. recordRefund yeniden okur: isaretliyse dokunmaz.
    await recordRefund(deps, order.id, REFUND_MARK_REASON.PAYMENT_ALREADY_REFUNDED, scope);
  }
}

/**
 * Siparisi CANCELLED (RESERVATION_EXPIRED) yazar - para alinmissa iade komutu
 * ve kalici iade isareti (#166, gecmiste kalir) ayni yazimda - sonra kilidi
 * birakir. Cakismada yazim sonucu siparisin son halini tasir.
 */
async function cancelLapsed(
  deps: StocklessCloseDeps,
  order: Order,
  refund: RefundRequest | undefined,
  charge: Charge,
  scope: RequestScope,
): Promise<TransitionWrite> {
  const closed = transitionOrder(
    order,
    ORDER_STATUS.CANCELLED,
    deps.clock,
    ERROR_CODES.RESERVATION_EXPIRED,
  );
  // Isaretin ani ve iade komutunun ani ayni (goc 0003 isareti komutun anindan yazar).
  const at = deps.clock.date();
  const reason =
    refund?.reason ??
    (charge === CHARGE.REFUNDED ? REFUND_MARK_REASON.PAYMENT_ALREADY_REFUNDED : undefined);
  const cancelled = reason === undefined ? closed : withRefund(closed, { reason, requestedAt: at });
  const command = refund === undefined ? [] : [refundRequestedEvent(cancelled, refund, at)];
  const write = await tryWriteTransition(deps.repository, order, cancelled, command);
  if (!write.written) {
    return write;
  }
  scope.logger.info(
    { orderId: order.id, from: order.status, charged: refund !== undefined },
    'kilidi dolan siparis kapatildi',
  );
  await releaseStock(deps, order, RELEASE_REASON.RESERVATION_EXPIRED, scope);
  return write;
}

/**
 * Hizli yol: iade komutu zaten kalici; dogrudan iade parayi beklemeden geri
 * verir. Basarisizsa komut payment-svc'de islenir (T7.4), burada yalniz WARN.
 */
async function refundNow(
  deps: StocklessCloseDeps,
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
