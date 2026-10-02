/**
 * Siparis supurucusu isci (T11.2 PR 2): sweep-expired-reservations use-case'ini
 * aralikla calistirir.
 *
 * - Zincirli setTimeout (outbox yayincisiyla ayni): bir tur bitmeden digeri
 *   baslamaz, yavas payment-svc'de turlar ust uste binmez.
 * - Her ornekte calisir, lider kilidi yok (karar 3a): ayni siparisi iki ornegin
 *   kapatmasini surum kontrolu onler (use-case'in basliginda).
 * - Kapanista (stop) yeni tur planlanmaz ve suren tur BEKLENIR: payment ve
 *   inventory istemcileri, Mongo yarim kalmis bir kapanisin altindan cekilmez.
 * - Her tur metrige yazilir (sweeper-metrics.ts); bir sey kapandiysa ozet satiri.
 */

import type { Logger } from '@getir/core';

import type { SweepExpiredReservations } from '../../application/sweep-expired-reservations.js';
import { recordSweepFailure, recordSweepRound } from './sweeper-metrics.js';

export interface ReservationSweeperOptions {
  readonly sweep: SweepExpiredReservations;
  readonly intervalMs: number;
  readonly logger: Logger;
}

export interface ReservationSweeper {
  stop(): Promise<void>;
}

export function startReservationSweeper(options: ReservationSweeperOptions): ReservationSweeper {
  const logger = options.logger.child({ component: 'reservation-sweeper' });
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const schedule = (): void => {
    if (!stopped) {
      timer = setTimeout(tick, options.intervalMs);
    }
  };

  const tick = (): void => {
    running = options.sweep(logger).then(
      (round) => {
        recordSweepRound(round);
        if (Object.values(round).some((count) => count > 0)) {
          logger.info({ ...round }, 'kilidi dolan siparisler supuruldu');
        }
        schedule();
      },
      (error: unknown) => {
        // Tur beklenmedik bicimde dustu (orn. Mongo okunamadi): isci durmaz.
        recordSweepFailure();
        logger.error({ err: error }, 'siparis supurucu turu basarisiz; aralik sonra tekrar');
        schedule();
      },
    );
  };

  schedule();
  logger.info({ intervalMs: options.intervalMs }, 'siparis supurucusu basladi');

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
