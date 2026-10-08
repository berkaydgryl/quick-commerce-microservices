/**
 * Kapanis (#167): gRPC durduktan SONRA arka planda suren risk_events kayitlari
 * sinirli sure beklenir, Mongo EN SON kapanir. Bitmeyen kayit birakilir; her
 * biri ayrica error + `failed` olarak bildirilir (sessiz kayip yok), burada
 * yalnizca sayisi yazilir. Bosaltma dusse de baglanti kapanir.
 */

import type { Logger } from '@getir/core';
import type { MongoEnv } from '@getir/mongo-kit';

import type { PendingRecords } from '../application/pending-records.js';
import { RISK_EVENT_DRAIN_DEFAULT_MS, RISK_STORE_CLOSE_RESERVE_MS } from '../config/constants.js';

/**
 * Bosaltma suresi: Mongo'nun islem siniri (o surede kayit ya biter ya surucu
 * keser), kapanis kancasinin butcesinden Mongo kapanis payi dusulerek
 * sinirli. Mongo yoksa ya da suresizse varsayilan (yine butceyle sinirli).
 */
export function recordDrainTimeoutMs(
  mongo: Pick<MongoEnv, 'operationTimeoutMs'> | undefined,
  hookTimeoutMs: number,
): number {
  const operation = mongo?.operationTimeoutMs ?? 0;
  const budget = Math.max(0, hookTimeoutMs - RISK_STORE_CLOSE_RESERVE_MS);
  return Math.min(operation > 0 ? operation : RISK_EVENT_DRAIN_DEFAULT_MS, budget);
}

export interface DrainThenCloseOptions {
  readonly pending: Pick<PendingRecords, 'drain'>;
  readonly timeoutMs: number;
  /** Deponun kapanisi (Mongo); her durumda cagrilir. */
  readonly close: () => Promise<void>;
  readonly logger: Logger;
}

export async function drainThenClose(options: DrainThenCloseOptions): Promise<void> {
  try {
    const abandoned = await options.pending.drain(options.timeoutMs);
    if (abandoned > 0) {
      options.logger.info(
        { abandoned, timeoutMs: options.timeoutMs },
        'kapanista yarim kalan risk kayitlari birakildi',
      );
    }
  } finally {
    await options.close();
  }
}
