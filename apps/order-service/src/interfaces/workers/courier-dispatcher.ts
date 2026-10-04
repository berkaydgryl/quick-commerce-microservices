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
 * Ulasilamazken her saniye satir yazilmaz (D1): kaynak basina (courier, siparis
 * deposu) ulasilamaz duruma GECIS bir kez WARN, geri gelis bir kez INFO;
 * aradaki turlar yalnizca metrik. Tur ozeti yalnizca atama, geri verme ya da
 * hata olunca (D2): bekleyenin yine "kurye yok" almasi satir yazmaz.
 */

import type { Logger } from '@getir/core';

import { DISPATCH_SOURCE } from '../../application/assign-courier-step.js';
import type { DispatchSource } from '../../application/assign-courier-step.js';
import type { DispatchCouriers, DispatchRound } from '../../application/dispatch-couriers.js';
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
  const unreachable = new Set<DispatchSource>();

  /** Kaynak basina gecis gunlugu: ulasilamaz olunca bir WARN, donunce bir INFO. */
  const noteReachability = (round: DispatchRound): void => {
    for (const source of [DISPATCH_SOURCE.STORE, DISPATCH_SOURCE.COURIER]) {
      if (round.unavailable === source) {
        if (!unreachable.has(source)) {
          unreachable.add(source);
          logger.warn(
            { err: round.cause, source, deferred: round.deferred },
            UNREACHABLE_MESSAGE[source],
          );
        }
      } else if (unreachable.has(source) && answered(round, source)) {
        unreachable.delete(source);
        logger.info({ source, ...counts(round) }, REACHABLE_MESSAGE[source]);
      }
    }
  };

  const schedule = (): void => {
    if (!stopped) {
      timer = setTimeout(tick, options.intervalMs);
    }
  };

  const tick = (): void => {
    running = options.dispatch(logger).then(
      (round) => {
        recordDispatchRound(round);
        noteReachability(round);
        if (round.assigned + round.released + round.failed > 0) {
          logger.info(counts(round), 'kurye atama turu tamamlandi');
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

const UNREACHABLE_MESSAGE: Readonly<Record<DispatchSource, string>> = {
  courier: 'kurye servisine ulasilamiyor; siparisler bekliyor, her turda yeniden denenecek',
  store: 'siparis deposuna ulasilamiyor; kurye atamasi bekliyor, her turda yeniden denenecek',
  order: 'kurye atamasi yapilamiyor; her turda yeniden denenecek',
};

const REACHABLE_MESSAGE: Readonly<Record<DispatchSource, string>> = {
  courier: 'kurye servisine yeniden ulasildi',
  store: 'siparis deposuna yeniden ulasildi',
  order: 'kurye atamasi yeniden yapilabiliyor',
};

/**
 * Bu turda kaynak cevap verdi mi? Depo: tur kuyrugu okudu (depoyla kesilmedi).
 * Courier: en az bir siparis courier'in cevabiyla sonuclandi (hata cevabi dahil).
 */
function answered(round: DispatchRound, source: DispatchSource): boolean {
  if (source !== DISPATCH_SOURCE.COURIER) {
    return true;
  }
  return (
    round.assigned + round.noCourier + round.released + round.skipped + round.failedBy.courier > 0
  );
}

/** Gunluk satirinin sayilari (hata nesnesi haric). */
function counts(round: DispatchRound): Record<string, number> {
  return {
    assigned: round.assigned,
    noCourier: round.noCourier,
    released: round.released,
    skipped: round.skipped,
    failed: round.failed,
    backedOff: round.backedOff,
    deferred: round.deferred,
  };
}
