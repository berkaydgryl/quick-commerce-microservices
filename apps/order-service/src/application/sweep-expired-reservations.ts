/**
 * Use-case: kilidi dolmus siparisleri kapatir (T11.2 PR 2). Zamanlayici
 * interfaces/workers/reservation-sweeper.ts'tedir; burasi TEK tur.
 *
 * Kullaniciya gorunen davranis bu turdan once de dogrudur: kilidi dusmus taslak
 * CreateOrder'da 410 alir, stoku inventory'nin kendi supurucusu geri verir.
 * Bu tur KAYITLARI ve PARAYI toparlar:
 *   - DRAFT: CANCELLED (RESERVATION_EXPIRED), kilit birakilir;
 *   - AWAITING_PAYMENT: once odeme kaydina bakilir (payment-standing.ts):
 *       para alinmis -> CANCELLED, kilit birakilir, tutar IADE edilir;
 *       kart cekimi suruyor -> bu turda dokunulmaz, sonraki turda tekrar;
 *       para alinmamis -> CANCELLED, kilit birakilir.
 *
 * Sira: once siparis yazilir (surum kontrollu), sonra kilit ve iade. Siparisi o
 * arada baska bir yazim degistirdiyse (CONFLICT) dokunulmaz. Lider kilidi yok
 * (karar 3a): surum kontrolu ve iadenin sabit anahtari (refund-<orderId>) iki
 * ornegin ayni siparisi iki kez kapatmasini ya da iki kez iade etmesini onler.
 * Bir siparisin hatasi turu durdurmaz: sayilir, siradakine gecilir.
 */

import { ERROR_CODES, isAppError, ORDER_STATUS } from '@getir/core';
import type { Logger } from '@getir/core';
import { resolveRequestId } from '@getir/observability';

import { REFUND_REASON } from '../domain/checkout-payment.js';
import type { ExpiredOrderFinder } from '../domain/expired-order-finder.js';
import { statusChangedEvents } from '../domain/order-events.js';
import type { OrderRepository } from '../domain/order-repository.js';
import type { Order } from '../domain/order.js';
import { transitionOrder } from '../domain/order.js';
import { PAYMENT_STANDING, paymentStandingOf } from '../domain/payment-standing.js';
import { RELEASE_REASON } from '../domain/stock-reservation.js';
import type { Payments } from './payments.js';
import { refundCharge } from './refund-step.js';
import type { RefundStepDeps } from './refund-step.js';
import type { RequestScope } from './request-scope.js';
import { releaseStock } from './stock-step.js';
import type { StockStepDeps } from './stock-step.js';

export interface SweepExpiredReservationsDeps extends StockStepDeps, RefundStepDeps {
  readonly expired: ExpiredOrderFinder;
  readonly repository: Pick<OrderRepository, 'update'>;
  readonly payments: Pick<Payments, 'getPayment' | 'refund'>;
  /** Bir turda en fazla kac siparis ele alinir. */
  readonly batchSize: number;
  /**
   * Her siparis kendi istek kimligiyle kapatilir: payment ve inventory
   * gunlugunde tek iz. Verilmezse yenisi uretilir (`req_` + 32 onaltilik).
   */
  readonly newRequestId?: () => string;
}

/** Turun sonucu; isci metrige ve gunluge yazar. */
export interface SweepRound {
  readonly closedDrafts: number;
  /** Odeme bekleyen ve kapatilan (iade edilenler dahil). */
  readonly closedAwaitingPayment: number;
  readonly refunded: number;
  /** Kart cekimi suruyor: sonraki turda. */
  readonly waiting: number;
  /** Baska bir yazim once davrandi (surum cakismasi): dokunulmadi. */
  readonly skipped: number;
  /** Kapatilamadi (payment ya da depo hatasi): sonraki turda. */
  readonly failed: number;
}

export type SweepExpiredReservations = (logger: Logger) => Promise<SweepRound>;

const OUTCOME = {
  CLOSED: 'closed',
  REFUNDED: 'refunded',
  WAITING: 'waiting',
  SKIPPED: 'skipped',
} as const;

type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];

export function createSweepExpiredReservations(
  deps: SweepExpiredReservationsDeps,
): SweepExpiredReservations {
  const newRequestId = deps.newRequestId ?? (() => resolveRequestId(undefined));
  return async (logger) => {
    const orders = await deps.expired.findExpiredReservations(deps.clock.date(), deps.batchSize);
    const round = {
      closedDrafts: 0,
      closedAwaitingPayment: 0,
      refunded: 0,
      waiting: 0,
      skipped: 0,
      failed: 0,
    };
    for (const order of orders) {
      const requestId = newRequestId();
      const scope: RequestScope = { requestId, logger: logger.child({ requestId }) };
      try {
        tally(round, order, await closeExpired(deps, order, scope));
      } catch (error: unknown) {
        round.failed += 1;
        scope.logger.warn(
          { err: error, orderId: order.id, status: order.status },
          'kilidi dolan siparis kapatilamadi; sonraki turda tekrar',
        );
      }
    }
    return round;
  };
}

async function closeExpired(
  deps: SweepExpiredReservationsDeps,
  order: Order,
  scope: RequestScope,
): Promise<Outcome> {
  if (order.status === ORDER_STATUS.DRAFT) {
    return (await cancelExpired(deps, order, false, scope)) ? OUTCOME.CLOSED : OUTCOME.SKIPPED;
  }
  const standing = paymentStandingOf(await deps.payments.getPayment(order.id, scope));
  if (standing === PAYMENT_STANDING.IN_FLIGHT) {
    return OUTCOME.WAITING;
  }
  const charged = standing === PAYMENT_STANDING.CHARGED;
  if (!(await cancelExpired(deps, order, charged, scope))) {
    return OUTCOME.SKIPPED;
  }
  if (!charged) {
    return OUTCOME.CLOSED;
  }
  await refundCharge(deps, order, REFUND_REASON.RESERVATION_EXPIRED, scope);
  return OUTCOME.REFUNDED;
}

/**
 * Siparisi CANCELLED (RESERVATION_EXPIRED) yazar, sonra kilidi birakir.
 * @returns yazildi mi? (false: surum cakismasi, siparis baska yolda ilerledi)
 */
async function cancelExpired(
  deps: SweepExpiredReservationsDeps,
  order: Order,
  charged: boolean,
  scope: RequestScope,
): Promise<boolean> {
  const cancelled = transitionOrder(
    order,
    ORDER_STATUS.CANCELLED,
    deps.clock,
    ERROR_CODES.RESERVATION_EXPIRED,
  );
  try {
    await deps.repository.update(cancelled, order.version, statusChangedEvents(order, cancelled));
  } catch (error: unknown) {
    if (isAppError(error) && error.code === ERROR_CODES.CONFLICT) {
      return false;
    }
    throw error;
  }
  scope.logger.info(
    { orderId: order.id, from: order.status, charged },
    'kilidi dolan siparis kapatildi',
  );
  await releaseStock(deps, order, RELEASE_REASON.RESERVATION_EXPIRED, scope);
  return true;
}

function tally(
  round: { -readonly [K in keyof SweepRound]: number },
  order: Order,
  outcome: Outcome,
): void {
  switch (outcome) {
    case OUTCOME.WAITING:
      round.waiting += 1;
      return;
    case OUTCOME.SKIPPED:
      round.skipped += 1;
      return;
    case OUTCOME.REFUNDED:
      round.refunded += 1;
      round.closedAwaitingPayment += 1;
      return;
    case OUTCOME.CLOSED:
      if (order.status === ORDER_STATUS.DRAFT) {
        round.closedDrafts += 1;
      } else {
        round.closedAwaitingPayment += 1;
      }
  }
}
