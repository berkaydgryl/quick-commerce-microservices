/**
 * Tek tuketici grubunun okuma dongusu (T7.4). Her tur iki adimdir:
 *
 *   1. TAKILANLAR: en az claimIdleMs'dir onaylanmamis kayitlar (coken ya da
 *      gecici hata alan tuketicinin) TEK TEK bu tuketiciye alinip yeniden
 *      islenir. Tek tek: toplu almak hepsinin teslim sayisini birden artirir;
 *      isleyiciyi cokerten bir kayit yuzunden digerlerinin hakki yanmasin.
 *   2. YENILER: XREADGROUP BLOCK ile beklenerek okunur, sirayla islenir.
 *      Grubun dinlemedigi konular turun sonunda tek XACK ile onaylanir.
 *
 * Kapanista (signal) yeni tur baslamaz; eldeki parti bitirilir - bu
 * tuketiciye teslim edilmis kayit yarim birakilirsa hakki bosuna yanar. Tur
 * hatasi (Redis koptu) gunluge yazilir, beklenip devam edilir; grup
 * silinmisse (Redis verisiz yeniden basladi) yeniden kurulur.
 */

import { setTimeout as delay } from 'node:timers/promises';

import type { Clock, Logger } from '@getir/core';

import type { DeliverySettings } from './delivery-settings.js';
import { dispatchEntry } from './dispatch.js';
import type { Settlement, StreamEntry } from './dispatch.js';
import { isNoGroupError } from './redis-stream-group.js';
import type { StreamGroup } from './redis-stream-group.js';
import { peekEnvelope } from './stream-fields.js';
import type { EventHandler } from './subscriber.js';

export interface GroupWorkerOptions {
  readonly stream: StreamGroup;
  /** Konu -> isleyici; dinleme basladiktan sonra degismez. */
  readonly handlers: ReadonlyMap<string, EventHandler>;
  readonly settings: DeliverySettings;
  readonly clock: Clock;
  /** Grup ve tuketici bagli gunlukcu. */
  readonly logger: Logger;
  readonly signal: AbortSignal;
}

/** signal kesilene kadar calisir; hata firlatmaz (tur hatalari icerde karsilanir). */
export async function runGroupWorker(options: GroupWorkerOptions): Promise<void> {
  while (!options.signal.aborted) {
    try {
      await reclaimStale(options);
      if (options.signal.aborted) {
        return;
      }
      await settleBatch(
        await options.stream.readNew(options.settings.batchSize, options.settings.blockMs),
        options,
      );
    } catch (error: unknown) {
      if (options.signal.aborted) {
        return;
      }
      await recover(error, options);
    }
  }
}

async function reclaimStale(options: GroupWorkerOptions): Promise<void> {
  const { claimIdleMs, batchSize } = options.settings;
  const stale = await options.stream.stalePending(claimIdleMs, batchSize);
  for (const pending of stale) {
    if (options.signal.aborted) {
      return;
    }
    const entry = await options.stream.claim(pending.id, claimIdleMs);
    // Bos: baska tuketici az once aldi ya da kayit akistan silindi (Redis bekleyenden de siler).
    if (entry !== undefined) {
      // XCLAIM teslim sayisini artirdi: bu, kaydin (deliveries + 1). teslimidir.
      const settlement = await settle(entry, pending.deliveries + 1, options);
      if (settlement.kind === 'skipped') {
        await options.stream.ack([entry.id]);
      }
    }
  }
}

async function settleBatch(
  entries: readonly StreamEntry[],
  options: GroupWorkerOptions,
): Promise<void> {
  const skipped: string[] = [];
  for (const entry of entries) {
    // Yeni okunan kayit ilk kez teslim edildi.
    const settlement = await settle(entry, 1, options);
    if (settlement.kind === 'skipped') {
      skipped.push(entry.id);
    }
  }
  await options.stream.ack(skipped);
}

/** Kaydi dagitir ve karari uygular; atlanan kaydin onayi cagirana birakilir (toplu XACK). */
async function settle(
  entry: StreamEntry,
  attempt: number,
  options: GroupWorkerOptions,
): Promise<Settlement> {
  const { settings, stream, logger } = options;
  const settlement = await dispatchEntry(entry, {
    attempt,
    maxDeliveries: settings.maxDeliveries,
    handlerFor: (topic) => options.handlers.get(topic),
    logger,
  });

  switch (settlement.kind) {
    case 'handled':
      await stream.ack([entry.id]);
      break;
    case 'skipped':
      break;
    case 'retry':
      logger.warn(
        {
          err: settlement.error,
          streamId: entry.id,
          ...peekOf(entry),
          attempt,
          ...limits(settings),
        },
        'olay islenemedi; takilma suresinden sonra yeniden teslim edilecek',
      );
      break;
    case 'dead':
      await stream.deadLetter(entry, {
        reason: settlement.reason,
        attempts: settlement.attempts,
        error: settlement.error,
        at: options.clock.date(),
      });
      // Mudahale gerektirir (iade komutu kaybolmasin): ERROR (proje kurali, seviye sozlesmesi).
      logger.error(
        {
          streamId: entry.id,
          ...peekOf(entry),
          reason: settlement.reason,
          attempts: settlement.attempts,
          error: settlement.error,
        },
        'olay islenemedi; olu olaylar akisina tasindi',
      );
      break;
  }
  return settlement;
}

async function recover(error: unknown, options: GroupWorkerOptions): Promise<void> {
  if (isNoGroupError(error)) {
    options.logger.warn(
      { err: error },
      'tuketici grubu yok (akis silinmis ya da Redis verisiz acilmis); yeniden kuruluyor',
    );
    try {
      await options.stream.ensure(options.settings.groupStart);
      return;
    } catch (ensureError: unknown) {
      options.logger.warn({ err: ensureError }, 'tuketici grubu kurulamadi; beklenip denenecek');
    }
  } else {
    options.logger.warn({ err: error }, 'olay okuma turu basarisiz; beklenip denenecek');
  }
  await pause(options.settings.retryDelayMs, options.signal);
}

/** Kapanista hemen biter: bekleme kapanisi geciktirmez. */
async function pause(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch {
    // Yalnizca durdurma (AbortError): dongu kosulu kapanisi gorur.
  }
}

function peekOf(entry: StreamEntry): { eventId?: string; topic?: string } {
  if (entry.fields === null) {
    return {};
  }
  const { eventId, topic } = peekEnvelope(entry.fields);
  return {
    ...(eventId === undefined ? {} : { eventId }),
    ...(topic === undefined ? {} : { topic }),
  };
}

function limits(settings: DeliverySettings): { maxDeliveries: number; claimIdleMs: number } {
  return { maxDeliveries: settings.maxDeliveries, claimIdleMs: settings.claimIdleMs };
}
