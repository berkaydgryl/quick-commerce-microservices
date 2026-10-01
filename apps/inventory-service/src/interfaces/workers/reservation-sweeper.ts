/**
 * Supurucu isci (T10.3; ADR-02, roadmap B25): her turda once liderligi alir ya
 * da yeniler, liderse suresi dolan rezervasyonlari geri verir.
 *
 * - setInterval DEGIL, zincirli setTimeout: bir tur bitmeden digeri baslamaz,
 *   yavas Redis'te turlar ust uste binmez (order'in outbox yayincisiyla ayni).
 * - Liderlik her turda yenilenir (kilit omru turdan belirgin buyuk); lider
 *   duserse kilit en gec omru dolunca baska ornege gecer.
 * - Liderlik degisimi gunluge bir kez yazilir; geri verilen olan turda ozet.
 * - Kapanista (stop) yeni tur planlanmaz, suren tur BEKLENIR, lider kilidini
 *   birakir: diger ornek beklemeden devralir.
 * - Liderlik, tur suresi ve sonuc metrige yazilir (T10.5, #12): sweeper-metrics.ts.
 */

import type { Logger } from '@getir/core';

import type { SweepExpired } from '../../application/sweep-expired.js';
import type { LeaderLock } from '../../domain/leader-lock.js';
import { recordLeadership, recordSweep, recordSweepFailure } from './sweeper-metrics.js';

/** hrtime nanosaniye doner; metrige saniye yaziyoruz. */
const NANOSECONDS_PER_SECOND = 1_000_000_000;

export interface ReservationSweeperOptions {
  readonly lock: LeaderLock;
  readonly sweep: SweepExpired;
  readonly intervalMs: number;
  readonly logger: Logger;
}

export interface ReservationSweeper {
  stop(): Promise<void>;
}

export function startReservationSweeper(options: ReservationSweeperOptions): ReservationSweeper {
  const logger = options.logger.child({ component: 'reservation-sweeper' });
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
    recordLeadership(holding);
    if (holding !== leader) {
      leader = holding;
      if (holding) {
        logger.info({}, 'supurucu lider oldu');
      } else {
        logger.warn({}, 'supurucu liderligi kaybetti');
      }
    }
    if (!holding) {
      return;
    }
    const startedAt = process.hrtime.bigint();
    const result = await options.sweep();
    recordSweep(result, Number(process.hrtime.bigint() - startedAt) / NANOSECONDS_PER_SECOND);
    if (result.expired > 0 || result.completed > 0 || result.pending > 0) {
      logger.info({ ...result }, 'suresi dolan rezervasyonlar geri verildi');
    }
  };

  const tick = (): void => {
    running = turn().then(schedule, (error: unknown) => {
      // Tur beklenmedik bicimde dustu (orn. Redis erisilemez): isci durmaz.
      recordSweepFailure();
      logger.error({ err: error }, 'supurucu turu basarisiz; aralik sonra tekrar');
      schedule();
    });
  };

  schedule();
  logger.info({ intervalMs: options.intervalMs }, 'supurucu basladi');

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
      if (leader) {
        await options.lock.release().catch((error: unknown) => {
          logger.warn({ err: error }, 'supurucu kilidi birakilamadi; omru dolunca duser');
        });
        recordLeadership(false);
      }
    },
  };
}
