/**
 * Tick isci (T13.3; karar M5 a): her COURIER_TICK_MS'de once liderligi alir ya
 * da yeniler, liderse ilerleyen rotalari bu ana getirir (advance-routes.ts).
 * inventory supurucusunun deseni:
 *
 * - setInterval DEGIL, zincirli setTimeout: bir tur bitmeden digeri baslamaz.
 * - Liderlik her turda yenilenir (kilit omru turdan belirgin buyuk); lider
 *   duserse kilit en gec omru dolunca baska ornege gecer.
 * - Liderlik degisimi gunluge bir kez yazilir; tur ozeti yalnizca bir
 *   kilometre tasi ya da hata olduysa.
 * - Tur SURE BUTCELIDIR (`budgetMs`, kilit omrunun yarisi): butce dolunca ya da
 *   isci kapanirken tur bir sonraki rotadan once kesilir; kalanlar sonraki
 *   turda. Kilit tur ortasinda dusup iki lider olusmasin. Yine de olursa
 *   adimlar kosullu ve tekrar guvenlidir (en kotu: olay iki kez yayinlanir).
 * - Kapanista (stop) yeni tur planlanmaz, suren tur (en gec suren rotasi
 *   bitince) BEKLENIR, lider kilidini birakir: diger ornek beklemeden devralir.
 */

import type { Logger } from '@getir/core';

import type { AdvanceRoutes } from '../../application/advance-routes.js';
import type { LeaderLock } from '../../domain/leader-lock.js';

export interface RouteTickerOptions {
  readonly lock: LeaderLock;
  readonly advance: AdvanceRoutes;
  readonly intervalMs: number;
  /** Bir turun sure butcesi (ms); asilirsa kalan rotalar sonraki turda. */
  readonly budgetMs: number;
  readonly logger: Logger;
}

export interface RouteTicker {
  stop(): Promise<void>;
}

export function startRouteTicker(options: RouteTickerOptions): RouteTicker {
  const logger = options.logger.child({ component: 'route-ticker' });
  let stopped = false;
  let leader = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const schedule = (): void => {
    if (!stopped) {
      timer = setTimeout(tick, options.intervalMs);
    }
  };

  const turn = async (): Promise<void> => {
    const holding = await options.lock.hold();
    if (holding !== leader) {
      leader = holding;
      if (holding) {
        logger.info({}, 'tick lider oldu');
      } else {
        logger.warn({}, 'tick liderligi kaybetti');
      }
    }
    if (!holding) {
      return;
    }
    const startedAt = Date.now();
    const summary = await options.advance(
      logger,
      () => !stopped && Date.now() - startedAt < options.budgetMs,
    );
    if (summary.deferred > 0 && !stopped) {
      logger.warn(
        { ...summary, budgetMs: options.budgetMs },
        'tur butcesi doldu; kalan rotalar sonraki turda',
      );
    } else if (
      summary.picked_up + summary.delivered + summary.ended + summary.failed + summary.reconciled >
      0
    ) {
      logger.info({ ...summary }, 'rotalar ilerletildi');
    }
  };

  const tick = (): void => {
    running = turn().then(schedule, (error: unknown) => {
      // Tur beklenmedik bicimde dustu (orn. Redis ya da Mongo erisilemez): isci durmaz.
      logger.error({ err: error }, 'tick turu basarisiz; aralik sonra tekrar');
      schedule();
    });
  };

  schedule();
  logger.info({ intervalMs: options.intervalMs }, 'tick basladi');

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
      if (leader) {
        await options.lock.release().catch((error: unknown) => {
          logger.warn({ err: error }, 'tick kilidi birakilamadi; omru dolunca duser');
        });
      }
    },
  };
}
