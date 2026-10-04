/**
 * Use-case: kurye bekleyen siparislere kurye atar (T13.1 PR 2). Zamanlayici
 * interfaces/workers/courier-dispatcher.ts'tedir; burasi TEK tur. Siparis
 * basina karar assign-courier-step.ts'te.
 *
 * Lider kilidi yok (supurucuyle ayni karar): iki order ornegi ayni siparisi
 * alirsa courier-svc ikisine ayni kuryeyi verir, surum kontrolu de siparise
 * tek yazim dusurur.
 *
 * courier-svc'ye ULASILAMAZSA (SERVICE_UNAVAILABLE; D17 devresi aciksa hemen)
 * tur kesilir: siradaki siparisler de ayni cevabi alacaktir, hepsi sonraki
 * turda denenir. Baska bir siparis hatasi turu durdurmaz: sayilir, siradakine
 * gecilir (supurucuyle ayni).
 */

import { ERROR_CODES, isAppError } from '@getir/core';
import type { Logger } from '@getir/core';
import { resolveRequestId } from '@getir/observability';

import type { AwaitingCourierFinder } from '../domain/awaiting-courier-finder.js';
import { assignCourierStep, COURIER_STEP_OUTCOME } from './assign-courier-step.js';
import type { AssignCourierStepDeps, CourierStepOutcome } from './assign-courier-step.js';
import type { RequestScope } from './request-scope.js';

export interface DispatchCouriersDeps extends AssignCourierStepDeps {
  readonly awaiting: AwaitingCourierFinder;
  /** Bir turda en fazla kac siparis ele alinir. */
  readonly batchSize: number;
  /**
   * Her siparis kendi istek kimligiyle islenir: courier-svc gunlugunde tek iz.
   * Verilmezse yenisi uretilir (`req_` + 32 onaltilik).
   */
  readonly newRequestId?: () => string;
}

/** Turun sonucu; isci metrige ve gunluge yazar. */
export interface DispatchRound {
  readonly assigned: number;
  /** Markette bos kurye yok: kuryesiz PREPARING, sonra yeniden. */
  readonly noCourier: number;
  /** Siparis atama sirasinda kapandi, kurye geri verildi. */
  readonly released: number;
  /** Baska bir yazim once davrandi: dokunulmadi. */
  readonly skipped: number;
  /** Atanamadi (courier ya da depo hatasi): sonraki turda. */
  readonly failed: number;
  /** courier-svc'ye ulasilamadi, tur kesildi: bu kadar siparis sonraki turda. */
  readonly deferred: number;
}

export type DispatchCouriers = (logger: Logger) => Promise<DispatchRound>;

export function createDispatchCouriers(deps: DispatchCouriersDeps): DispatchCouriers {
  const newRequestId = deps.newRequestId ?? (() => resolveRequestId(undefined));
  return async (logger) => {
    const orders = await deps.awaiting.findAwaitingCourier(deps.clock.date(), deps.batchSize);
    const round = { assigned: 0, noCourier: 0, released: 0, skipped: 0, failed: 0, deferred: 0 };
    for (const [index, order] of orders.entries()) {
      const requestId = newRequestId();
      const scope: RequestScope = { requestId, logger: logger.child({ requestId }) };
      try {
        tally(round, await assignCourierStep(deps, order, scope));
      } catch (error: unknown) {
        if (isAppError(error) && error.code === ERROR_CODES.SERVICE_UNAVAILABLE) {
          round.deferred = orders.length - index;
          scope.logger.debug(
            { err: error, orderId: order.id, deferred: round.deferred },
            'kurye atanamadi (ulasilamiyor); tur kesildi, sonraki turda tekrar',
          );
          break;
        }
        round.failed += 1;
        scope.logger.warn(
          { err: error, orderId: order.id, status: order.status },
          'siparise kurye atanamadi; sonraki turda tekrar',
        );
      }
    }
    return round;
  };
}

function tally(
  round: { -readonly [K in keyof DispatchRound]: number },
  outcome: CourierStepOutcome,
): void {
  switch (outcome) {
    case COURIER_STEP_OUTCOME.ASSIGNED:
      round.assigned += 1;
      return;
    case COURIER_STEP_OUTCOME.NO_COURIER:
      round.noCourier += 1;
      return;
    case COURIER_STEP_OUTCOME.RELEASED:
      round.released += 1;
      return;
    case COURIER_STEP_OUTCOME.SKIPPED:
      round.skipped += 1;
  }
}
