/**
 * Use-case: Redis bosalinca sayaclari kendiliginden yeniden kurmak (T10.1 PR 2,
 * bekleyen #36; ADR-17).
 *
 * Yalnizca bir sayac BULUNAMADIGINDA cagrilir (normal istekte ek maliyet yok):
 *  - isaret yerinde: Redis bosalmamis, SKU gercekten bu markette yok -> false;
 *  - isaret yok: sayaclar Mongo'dan yeniden yazilir -> true, cagiran okumayi
 *    bir kez tekrarlar. Yalnizca EKSIK sayaclar yazilir (SET NX): baska bir
 *    ornek ayni anda kursa da zararsiz.
 *
 * Tek ucus: ayni anda gelen istekler AYNI kurulumu bekler. Bekleme sure
 * sinirlidir; asilirsa ya da kurulum dusmusse SERVICE_UNAVAILABLE (tekrar
 * denenebilir). Sure asiminda kurulum arka planda surer.
 *
 * Redis bosalinca aktif rezervasyonlar da gitmistir: sayaclar eldeki adetten
 * yazilir. Onay ve defter (T10.2) gelince formul B24'e gore genisler.
 */

import { AppError, ERROR_CODES } from '@getir/core';
import type { Logger } from '@getir/core';

import type { CounterRecovery, CounterSetMarker } from '../domain/stock.js';
import type { SeedCountersResult } from './seed-counters.js';

export interface CounterRecoveryDeps {
  readonly marker: CounterSetMarker;
  /** Eksik sayaclari Mongo'dan yazar ve en son isareti koyar (seed-counters, missing). */
  readonly reseed: () => Promise<SeedCountersResult>;
  readonly logger: Logger;
  /** Bir istegin kurulumu en fazla bekledigi sure. */
  readonly timeoutMs: number;
}

export function createCounterRecovery(deps: CounterRecoveryDeps): CounterRecovery {
  let inFlight: Promise<void> | undefined;

  const rebuild = async (): Promise<void> => {
    deps.logger.warn({}, "stok sayaclari Redis'te yok (isaret kayip); Mongo'dan yeniden yaziliyor");
    try {
      const result = await deps.reseed();
      deps.logger.info({ ...result }, 'stok sayaclari yeniden yazildi');
    } catch (error: unknown) {
      deps.logger.error({ err: error }, 'stok sayaclari yeniden yazilamadi');
      throw error;
    }
  };

  return async () => {
    if (await deps.marker.isPresent()) {
      return false;
    }
    inFlight ??= rebuild().finally(() => {
      inFlight = undefined;
    });
    await waitWithin(inFlight, deps.timeoutMs);
    return true;
  };
}

/** Kurulumu en fazla `timeoutMs` bekler; zamanlayici her durumda temizlenir. */
async function waitWithin(work: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Stok sayaclari yeniden kuruluyor', {
          details: { timeoutMs },
        }),
      );
    }, timeoutMs);
  });
  try {
    await Promise.race([work, timeout]);
  } catch (error: unknown) {
    if (error instanceof AppError && error.code === ERROR_CODES.SERVICE_UNAVAILABLE) {
      throw error;
    }
    throw new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Stok sayaclari yeniden kurulamadi', {
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}
