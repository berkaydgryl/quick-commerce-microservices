/**
 * Kurye atayan isci (T13.1 PR 2): dispatch-couriers use-case'ini aralikla
 * calistirir. Supurucuyle (reservation-sweeper.ts) ayni zamanlama:
 *
 * - Zincirli setTimeout: bir tur bitmeden digeri baslamaz, yavas courier-svc'de
 *   turlar ust uste binmez.
 * - Her ornekte calisir, lider kilidi yok: ayni siparisi iki ornegin yazmasini
 *   surum kontrolu, iki kurye almasini courier-svc'nin tekrar guvenligi onler.
 * - Kapanista (stop) yeni tur planlanmaz ve suren tur BEKLENIR: courier istemcisi
 *   ve Mongo yarim kalmis bir atamanin altindan cekilmez.
 *
 * courier-svc'ye ulasilamazken her saniye satir yazilmaz: ulasilamaz duruma
 * GECIS bir kez WARN, geri gelis bir kez INFO; aradaki turlar yalnizca metrik.
 */

import type { Logger } from '@getir/core';

import type { DispatchCouriers } from '../../application/dispatch-couriers.js';
import { recordDispatchFailure, recordDispatchRound } from './dispatcher-metrics.js';

export interface CourierDispatcherOptions {
  readonly dispatch: DispatchCouriers;
  readonly intervalMs: number;
  readonly logger: Logger;
}

export interface CourierDispatcher {
  stop(): Promise<void>;
}

export function startCourierDispatcher(options: CourierDispatcherOptions): CourierDispatcher {
  const logger = options.logger.child({ component: 'courier-dispatcher' });
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  let unreachable = false;

  const schedule = (): void => {
    if (!stopped) {
      timer = setTimeout(tick, options.intervalMs);
    }
  };

  const tick = (): void => {
    running = options.dispatch(logger).then(
      (round) => {
        recordDispatchRound(round);
        if (round.deferred > 0 && !unreachable) {
          logger.warn(
            { deferred: round.deferred },
            'kurye servisine ulasilamiyor; siparisler bekliyor, her turda yeniden denenecek',
          );
        } else if (round.deferred === 0 && unreachable) {
          logger.info({ ...round }, 'kurye servisine yeniden ulasildi');
        }
        unreachable = round.deferred > 0;
        const { deferred: _metricOnly, ...counts } = round;
        if (Object.values(counts).some((count) => count > 0)) {
          logger.info({ ...round }, 'kurye atama turu tamamlandi');
        }
        schedule();
      },
      (error: unknown) => {
        // Tur beklenmedik bicimde dustu (orn. Mongo okunamadi): isci durmaz.
        recordDispatchFailure();
        logger.error({ err: error }, 'kurye atama turu basarisiz; aralik sonra tekrar');
        schedule();
      },
    );
  };

  schedule();
  logger.info({ intervalMs: options.intervalMs }, 'kurye atayan isci basladi');

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
