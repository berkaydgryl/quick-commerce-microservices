/**
 * Use-case: kilidi dolmus siparisleri kapatir (T11.2 PR 2). Zamanlayici
 * interfaces/workers/reservation-sweeper.ts'tedir; burasi TEK tur.
 *
 * Kullaniciya gorunen davranis bu turdan once de dogrudur: kilidi dusmus taslak
 * CreateOrder'da 410 alir, stoku inventory'nin kendi supurucusu geri verir.
 * Bu tur KAYITLARI ve PARAYI toparlar (karar lapsed-order.ts'te; odeme ya da 3DS
 * denemesinde kilidi dusmus bulan saga da ayni tabloyu kullanir, T15.3):
 *   - DRAFT: CANCELLED (RESERVATION_EXPIRED), kilit birakilir;
 *   - AWAITING_PAYMENT: once odeme kaydina bakilir (payment-standing.ts):
 *       para alinmis -> once Commit: stok kesinlesmisse PAID (bekleyen is 124);
 *         kilit yoksa CANCELLED + iade komutu ayni yazimda, kilit birakilir,
 *         tutar IADE edilir;
 *       kart cekimi suruyor -> bu turda dokunulmaz, sonraki turda tekrar;
 *       para alinmamis -> CANCELLED, kilit birakilir.
 *
 * Sira: once siparis yazilir (surum kontrollu), sonra kilit ve iade. Siparisi o
 * arada baska bir yazim degistirdiyse (CONFLICT) dokunulmaz; para alinmis ve
 * siparisi baska yol iptal etmisse iade yine yapilir (lapsed-order.ts). Lider kilidi yok
 * (karar 3a): surum kontrolu ve iadenin sabit anahtari (refund-<orderId>) iki
 * ornegin ayni siparisi iki kez kapatmasini ya da iki kez iade etmesini onler.
 * Bir siparisin hatasi turu durdurmaz: sayilir, siradakine gecilir.
 */

import { ORDER_STATUS } from '@getir/core';
import type { Logger } from '@getir/core';
import { resolveRequestId } from '@getir/observability';

import type { ExpiredOrderFinder } from '../domain/expired-order-finder.js';
import type { Order } from '../domain/order.js';
import { closeLapsedOrder } from './lapsed-order.js';
import type { LapseDeps } from './lapsed-order.js';
import type { RequestScope } from './request-scope.js';

export interface SweepExpiredReservationsDeps extends LapseDeps {
  readonly expired: ExpiredOrderFinder;
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
  /** Para alinmis, stogu kesinlesmis (ilk deneme PAID yazamamis): PAID yazildi. */
  readonly completedPaid: number;
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
  COMPLETED: 'completed',
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
      completedPaid: 0,
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

/** Kapatma karari lapsed-order.ts'te (lock-timing ile ayni tablo); burada tur sayimi. */
async function closeExpired(
  deps: SweepExpiredReservationsDeps,
  order: Order,
  scope: RequestScope,
): Promise<Outcome> {
  const outcome = await closeLapsedOrder(deps, order, scope);
  switch (outcome.kind) {
    case 'in-flight':
      return OUTCOME.WAITING;
    case 'conflict':
      return OUTCOME.SKIPPED;
    case 'refunded':
      return OUTCOME.REFUNDED;
    case 'paid':
      // Yalniz bu tur PAID yazdiysa sayilir; baska yol yazdiysa dokunulmamistir.
      return outcome.recovered ? OUTCOME.COMPLETED : OUTCOME.SKIPPED;
    case 'closed':
      return OUTCOME.CLOSED;
  }
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
    case OUTCOME.COMPLETED:
      round.completedPaid += 1;
      return;
    case OUTCOME.CLOSED:
      if (order.status === ORDER_STATUS.DRAFT) {
        round.closedDrafts += 1;
      } else {
        round.closedAwaitingPayment += 1;
      }
  }
}
