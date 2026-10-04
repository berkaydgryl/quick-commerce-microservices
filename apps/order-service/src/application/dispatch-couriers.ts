/**
 * Use-case: kurye bekleyen siparislere kurye atar (T13.1 PR 2). Zamanlayici
 * interfaces/workers/courier-dispatcher.ts'tedir; burasi TEK tur. Siparis
 * basina karar assign-courier-step.ts'te.
 *
 * Kuyruk (#92, T13.2): once kurye istenecekler okunur (yeni odeme ya da deneme
 * ani gelmis bekleyen). Varsa, onlardan once odemis kuryesiz bekleyenler de
 * okunur ve hepsi ODEME SIRASIYLA denenir (domain courierQueue): bosalan
 * kurye ona ulasabilen en eski siparise gider. Talep yoksa tur bostur.
 *
 * Lider kilidi yok (supurucuyle ayni karar): iki order ornegi ayni siparisi
 * alirsa courier-svc ikisine ayni kuryeyi verir, surum kontrolu de siparise
 * tek yazim dusurur.
 *
 * Ayni turda bir market icin courier "kurye yok" dediyse (QA O2), o marketin
 * siradaki siparisleri courier'e SORULMAZ: ayni market ayni havuzdur, cevap
 * ayni olur. Odenmis olan kuryesiz PREPARING'e gecer, bekleyen yazilmaz
 * (assign-courier-step.ts waitForCourier). Turda courier cagrisi en cok
 * kurye bulamayan market sayisi kadar artar.
 *
 * ULASILAMAMA (SERVICE_UNAVAILABLE; D17 devresi aciksa hemen) turu keser:
 * siradaki siparisler de ayni cevabi alacaktir, hepsi sonraki turda denenir.
 * Kaynagi ayrilir (D1): courier mi, siparis deposu mu. Kuyruk okunamazsa da
 * tur yapilamaz, kaynak depo. Baska bir siparis hatasi turu durdurmaz:
 * sayilir, siparis geri cekilir (D3: 1 sn'den 5 dk'ya, siparis basina tek
 * WARN), siradakine gecilir.
 */

import { ERROR_CODES, isAppError } from '@getir/core';
import type { Logger } from '@getir/core';
import { resolveRequestId } from '@getir/observability';

import {
  COURIER_FAILURE_BACKOFF_INITIAL_MS,
  COURIER_FAILURE_BACKOFF_MAX_MS,
} from '../config/constants.js';
import type { AwaitingCourierFinder } from '../domain/awaiting-courier-finder.js';
import { courierQueue, latestQueueTime } from '../domain/courier-dispatch.js';
import type { Order } from '../domain/order.js';
import {
  assignCourierStep,
  COURIER_STEP_OUTCOME,
  DISPATCH_SOURCE,
  failureOf,
  waitForCourier,
} from './assign-courier-step.js';
import type {
  AssignCourierStepDeps,
  CourierStepOutcome,
  DispatchSource,
} from './assign-courier-step.js';
import { FailureBackoff } from './failure-backoff.js';
import type { FailureBackoffOptions } from './failure-backoff.js';
import type { RequestScope } from './request-scope.js';

export interface DispatchCouriersDeps extends AssignCourierStepDeps {
  readonly awaiting: AwaitingCourierFinder;
  /** Bir turda en fazla kac talep (ve bir o kadar onceki bekleyen) ele alinir. */
  readonly batchSize: number;
  /**
   * Her siparis kendi istek kimligiyle islenir: courier-svc gunlugunde tek iz.
   * Verilmezse yenisi uretilir (`req_` + 32 onaltilik).
   */
  readonly newRequestId?: () => string;
  /** Atanamayan siparisin geri cekilmesi (D3); verilmezse 1 sn -> 5 dk. */
  readonly backoff?: FailureBackoffOptions;
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
  /** Atanamadi (courier ya da depo hatasi): geri cekildi, sonra yeniden. */
  readonly failed: number;
  /** Atanamayanlar, hatanin kaynagina gore (metrik etiketi, D1). */
  readonly failedBy: Readonly<Record<DispatchSource, number>>;
  /** Onceki hatasi yuzunden geri cekilmede: bu turda denenmedi (D3). */
  readonly backedOff: number;
  /** Tur kesildi (ulasilamadi): bu kadar siparis sonraki turda. */
  readonly deferred: number;
  /** Turu kesen ya da hic yaptirmayan kaynak: courier ya da depo (D1). */
  readonly unavailable?: DispatchSource;
  /** Ulasilamamanin hatasi: isci gecis WARN'ina yazar. */
  readonly cause?: unknown;
}

export type DispatchCouriers = (logger: Logger) => Promise<DispatchRound>;

type MutableRound = { -readonly [K in keyof DispatchRound]: DispatchRound[K] } & {
  failedBy: Record<DispatchSource, number>;
};

export function createDispatchCouriers(deps: DispatchCouriersDeps): DispatchCouriers {
  const newRequestId = deps.newRequestId ?? (() => resolveRequestId(undefined));
  const backoff = new FailureBackoff(
    deps.backoff ?? {
      initialMs: COURIER_FAILURE_BACKOFF_INITIAL_MS,
      maxMs: COURIER_FAILURE_BACKOFF_MAX_MS,
    },
  );
  return async (logger) => {
    const now = deps.clock.date();
    const round = emptyRound();
    backoff.prune(now);
    const backedOff = (order: Order) => backoff.isWaiting(order.id, now);
    let queue: readonly Order[];
    try {
      const read = await readQueue(deps.awaiting, now, deps.batchSize, backedOff);
      queue = read.queue;
      round.backedOff = read.backedOff;
    } catch (error: unknown) {
      logger.debug({ err: error }, 'kurye kuyrugu okunamadi; sonraki turda tekrar');
      return { ...round, unavailable: DISPATCH_SOURCE.STORE, cause: error };
    }
    /** Bu turda courier'in "kurye yok" dedigi marketler (O2). */
    const withoutCourier = new Set<string>();
    for (const [index, order] of queue.entries()) {
      if (backoff.isWaiting(order.id, now)) {
        round.backedOff += 1;
        continue;
      }
      const requestId = newRequestId();
      const scope: RequestScope = { requestId, logger: logger.child({ requestId }) };
      try {
        const outcome = withoutCourier.has(order.marketId)
          ? await waitForCourier(deps, order, scope)
          : await assignCourierStep(deps, order, scope);
        if (outcome === COURIER_STEP_OUTCOME.NO_COURIER) {
          withoutCourier.add(order.marketId);
        }
        tally(round, outcome);
        backoff.succeeded(order.id);
      } catch (thrown: unknown) {
        const { source, error } = failureOf(thrown);
        if (isAppError(error) && error.code === ERROR_CODES.SERVICE_UNAVAILABLE) {
          round.deferred = queue.length - index;
          round.unavailable = source;
          round.cause = error;
          scope.logger.debug(
            { err: error, source, orderId: order.id, deferred: round.deferred },
            'kurye atanamadi (ulasilamiyor); tur kesildi, sonraki turda tekrar',
          );
          break;
        }
        round.failed += 1;
        round.failedBy[source] += 1;
        noteFailure(backoff, order, source, error, now, scope);
      }
    }
    return round;
  };
}

/**
 * Turun kuyrugu: kurye istenecekler; varsa onlardan once odemis bekleyenler.
 * Ikisi de en fazla `limit`; sira domain courierQueue'da. Geri cekilmedeki
 * siparis talep SAYILMAZ (D3): hep hata veren bir siparis, ondan once odemis
 * bekleyenleri her turda yeniden denetmesin.
 */
async function readQueue(
  awaiting: AwaitingCourierFinder,
  now: Date,
  limit: number,
  backedOff: (order: Order) => boolean,
): Promise<{ readonly queue: readonly Order[]; readonly backedOff: number }> {
  const due = await awaiting.findAwaitingCourier(now, limit);
  const demand = due.filter((order) => !backedOff(order));
  const skipped = due.length - demand.length;
  const latest = latestQueueTime(demand);
  if (latest === undefined) {
    return { queue: [], backedOff: skipped };
  }
  return {
    queue: courierQueue(demand, await awaiting.findWaitingBefore(latest, limit)),
    backedOff: skipped,
  };
}

/** Atanamayan siparis geri cekilir; WARN yalnizca ilk hatada (D3), sonrakiler DEBUG. */
function noteFailure(
  backoff: FailureBackoff,
  order: Order,
  source: DispatchSource,
  error: unknown,
  now: Date,
  scope: RequestScope,
): void {
  const step = backoff.failed(order.id, now);
  const fields = {
    err: error,
    source,
    orderId: order.id,
    status: order.status,
    failures: step.failures,
    retryAt: step.retryAt,
  };
  if (step.first) {
    scope.logger.warn(fields, 'siparise kurye atanamadi; geri cekilerek yeniden denenecek');
  } else {
    scope.logger.debug(fields, 'siparise kurye yine atanamadi');
  }
}

function emptyRound(): MutableRound {
  return {
    assigned: 0,
    noCourier: 0,
    released: 0,
    skipped: 0,
    failed: 0,
    failedBy: { courier: 0, store: 0, order: 0 },
    backedOff: 0,
    deferred: 0,
  };
}

function tally(round: MutableRound, outcome: CourierStepOutcome): void {
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
