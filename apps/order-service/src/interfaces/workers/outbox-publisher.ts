/**
 * Outbox yayinci isci (T7.3): relay-outbox use-case'ini aralikla calistirir.
 *
 * - setInterval DEGIL, zincirli setTimeout: bir tur bitmeden digeri baslamaz,
 *   yavas Redis'te turlar ust uste binmez.
 * - Tam dolu parti ciktiysa beklemeden devam edilir (birikmis kuyruk erir);
 *   degilse aralik kadar beklenir.
 * - Kapanista (stop) yeni tur planlanmaz ve suren tur BEKLENIR: Redis ve
 *   Mongo baglantisi yarim kalmis bir yayinin altindan cekilmez.
 */

import type { Logger } from '@getir/core';

import type { RelayOutbox } from '../../application/relay-outbox.js';

export interface OutboxPublisherOptions {
  readonly relay: RelayOutbox;
  readonly intervalMs: number;
  /** relay'in parti boyu: bu kadar yayinlandiysa kuyrukta daha olabilir. */
  readonly batchSize: number;
  readonly logger: Logger;
}

export interface OutboxPublisherWorker {
  stop(): Promise<void>;
}

export function startOutboxPublisher(options: OutboxPublisherOptions): OutboxPublisherWorker {
  const logger = options.logger.child({ component: 'outbox-publisher' });
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const schedule = (delayMs: number): void => {
    if (!stopped) {
      timer = setTimeout(tick, delayMs);
    }
  };

  const tick = (): void => {
    running = options.relay(logger).then(
      (published) => {
        schedule(published >= options.batchSize ? 0 : options.intervalMs);
      },
      (error: unknown) => {
        // Tur beklenmedik bicimde dustu (orn. Mongo okunamadi): isci durmaz.
        logger.error({ err: error }, 'outbox turu basarisiz; aralik sonra tekrar');
        schedule(options.intervalMs);
      },
    );
  };

  schedule(options.intervalMs);
  logger.info({ intervalMs: options.intervalMs }, 'outbox yayincisi basladi');

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
