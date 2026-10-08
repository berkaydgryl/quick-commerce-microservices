/**
 * Use-case: tick turu (T13.3). Ilerleyen rotalari eskiden yeniye okur ve her
 * birini bu ana getirir (advance-route.ts). Bir rotanin hatasi turu durdurmaz:
 * o rota sonraki turda yeniden denenir.
 *
 * Rotalarin kuryeleri turun basinda TEK okumayla alinir (N+1 yok). Rotalar
 * SIRAYLA ilerletilir: Mongo'ya ayni anda en fazla bir yazim gider.
 *
 * Her rotadan ONCE `shouldContinue` sorulur: isci kapaniyorsa ya da turun sure
 * butcesi (lider kilidinin omrunun yarisi) dolduysa tur kesilir; kalan rotalar
 * sonraki turda (`deferred`). Boylece kilit tur ortasinda dusmez, kapanis tum
 * partiyi beklemez.
 *
 * Turun BASINDA, en fazla `reconcile.intervalMs`'de bir, BUSY kalan kurye
 * uzlastirmasi kosar (#205, reconcile-carriers.ts): yogun turlarda da ac
 * kalmaz; birakmalari ayni butceye tabidir. Hatasi turu bozmaz (yalnizca WARN).
 */

import type { Clock, Logger } from '@getir/core';

import type { AdvanceOutcome, AdvanceRoute } from './advance-route.js';
import { ADVANCE_OUTCOME } from './advance-route.js';
import type { ReconcileCarriers } from './reconcile-carriers.js';
import type { Courier } from '../domain/courier.js';
import type { CourierBatchReader } from '../domain/courier-repository.js';
import type { MovingRouteRepository } from '../domain/route-repository.js';

type SummaryKey = AdvanceOutcome | 'failed' | 'deferred' | 'reconciled';

export type AdvanceSummary = Readonly<Record<SummaryKey, number>>;

/** `shouldContinue` false donerse tur o rotadan itibaren kesilir. */
export type AdvanceRoutes = (
  logger: Logger,
  shouldContinue?: () => boolean,
) => Promise<AdvanceSummary>;

export interface AdvanceRoutesDeps {
  readonly routes: Pick<MovingRouteRepository, 'listMoving'>;
  readonly couriers: CourierBatchReader;
  readonly advance: AdvanceRoute;
  /** Bir turda en fazla bu kadar rota (TICK_BATCH_SIZE). */
  readonly batchSize: number;
  /** BUSY kalan kurye uzlastirmasi (#205); verilmezse yapilmaz. */
  readonly reconcile?: {
    readonly run: ReconcileCarriers;
    /** En fazla bu aralikla (ms; CARRIER_RECONCILE_INTERVAL_MS). */
    readonly intervalMs: number;
    readonly clock: Clock;
  };
}

export function createAdvanceRoutes(deps: AdvanceRoutesDeps): AdvanceRoutes {
  let lastReconcileMs = Number.NEGATIVE_INFINITY;
  return async (logger, shouldContinue = () => true) => {
    const summary: Record<SummaryKey, number> = {
      [ADVANCE_OUTCOME.MOVING]: 0,
      [ADVANCE_OUTCOME.PICKED_UP]: 0,
      [ADVANCE_OUTCOME.DELIVERED]: 0,
      [ADVANCE_OUTCOME.ENDED]: 0,
      [ADVANCE_OUTCOME.STALE]: 0,
      failed: 0,
      deferred: 0,
      reconciled: 0,
    };
    const { reconcile } = deps;
    const now = reconcile?.clock.now() ?? 0;
    if (
      reconcile !== undefined &&
      shouldContinue() &&
      now - lastReconcileMs >= reconcile.intervalMs
    ) {
      lastReconcileMs = now;
      try {
        summary.reconciled = await reconcile.run(logger, shouldContinue);
      } catch (error: unknown) {
        logger.warn({ err: error }, 'kurye uzlastirmasi yapilamadi; sonraki aralikta tekrar');
      }
    }
    const routes = await deps.routes.listMoving(deps.batchSize);
    const couriers = await couriersById(deps.couriers, routes);
    for (const [index, route] of routes.entries()) {
      if (!shouldContinue()) {
        summary.deferred = routes.length - index;
        break;
      }
      try {
        summary[await deps.advance(route, couriers.get(route.courierId) ?? null, logger)] += 1;
      } catch (error: unknown) {
        summary.failed += 1;
        logger.warn(
          { err: error, orderId: route.orderId, courierId: route.courierId },
          'rota ilerletilemedi; sonraki turda tekrar',
        );
      }
    }
    return summary;
  };
}

async function couriersById(
  reader: CourierBatchReader,
  routes: readonly { readonly courierId: string }[],
): Promise<ReadonlyMap<string, Courier>> {
  if (routes.length === 0) {
    return new Map();
  }
  const ids = [...new Set(routes.map((route) => route.courierId))];
  return new Map((await reader.findByIds(ids)).map((courier) => [courier.id, courier]));
}
