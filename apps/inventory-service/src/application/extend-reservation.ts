/**
 * Use-case: rezervasyonu uzatir (T11.3; roadmap B21). Order odeme ya da 3DS
 * denemesinden ONCE cagirir: deneme kilit dusmeden bitsin.
 *
 * Sonuclar:
 *  - uzatildi: yeni bitis ve bu uzatma dahil toplam sayi. Stok defterine kalem
 *    basina uzatma kaydi yazilir (delta 0, sira numarasiyla). Defter
 *    YAZILAMAZSA uzatma geri alinmaz, UYARI yazilir: kayit iz icindir, stok
 *    hareket etmedi. Hata donmek, order'in tekrar denerken bir uzatma hakkini
 *    bosa yakmasina yol acardi.
 *  - hak bitmis: sure degismez, `alreadyExtended` (hata degil; cagiran kalan
 *    sureyle devam eder).
 *  - aktif rezervasyon yok (birakilmis, onaylanmis, bitis ani gecmis):
 *    RESERVATION_EXPIRED. Dusmus kilit uzatilarak diriltilmez.
 *
 * Hak sayisi servisindir (RESERVATION_MAX_EXTENSIONS); sureyi order verir.
 */

import type { Clock, Logger } from '@getir/core';

import { MS_PER_SECOND } from '../config/constants.js';
import type { ReservationStore } from '../domain/reservation.js';
import { extendEntries } from '../domain/stock-ledger.js';
import type { StockLedger } from '../domain/stock-ledger.js';
import { reservationNotActive } from './inactive-reservation.js';

export interface ExtendReservationDeps {
  readonly reservations: Pick<ReservationStore, 'extend'>;
  readonly ledger: Pick<StockLedger, 'record'>;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Rezervasyon basina en cok uzatma (RESERVATION_MAX_EXTENSIONS). */
  readonly maxExtensions: number;
}

export interface ExtendReservationInput {
  readonly orderId: string;
  readonly marketId: string;
  readonly additionalSeconds: number;
}

export interface ExtendReservationResult {
  readonly expiresAt: Date;
  /** true: hak bitmisti, sure degismedi. */
  readonly alreadyExtended: boolean;
  /** Bu cagridan sonra toplam uzatma sayisi. */
  readonly extensionCount: number;
}

export type ExtendReservation = (input: ExtendReservationInput) => Promise<ExtendReservationResult>;

export function createExtendReservation(deps: ExtendReservationDeps): ExtendReservation {
  return async (input) => {
    const { orderId, marketId, additionalSeconds } = input;
    const nowMs = deps.clock.now();
    const outcome = await deps.reservations.extend({
      orderId,
      marketId,
      nowMs,
      additionalMs: additionalSeconds * MS_PER_SECOND,
      maxExtensions: deps.maxExtensions,
    });

    switch (outcome.status) {
      case 'extended': {
        const { expiresAt, extensionCount, lines } = outcome;
        deps.logger.info(
          { orderId, marketId, expiresAt: new Date(expiresAt), extensionCount },
          'rezervasyon uzatildi',
        );
        await recordBestEffort(
          deps,
          () =>
            deps.ledger.record(
              extendEntries({
                orderId,
                marketId,
                lines,
                sequence: extensionCount,
                at: new Date(nowMs),
              }),
            ),
          { orderId, marketId, extensionCount },
        );
        return { expiresAt: new Date(expiresAt), alreadyExtended: false, extensionCount };
      }
      case 'limit-reached':
        deps.logger.info(
          { orderId, marketId, extensionCount: outcome.extensionCount },
          'rezervasyon uzatilmadi: uzatma hakki bitti',
        );
        return {
          expiresAt: new Date(outcome.expiresAt),
          alreadyExtended: true,
          extensionCount: outcome.extensionCount,
        };
      case 'inactive':
        throw reservationNotActive(input, outcome);
    }
  };
}

/** Defter kaydi iz icindir: yazilamazsa uzatma gecerli kalir, uyari yazilir. */
async function recordBestEffort(
  deps: Pick<ExtendReservationDeps, 'logger'>,
  write: () => Promise<void>,
  context: Readonly<Record<string, unknown>>,
): Promise<void> {
  try {
    await write();
  } catch (error: unknown) {
    deps.logger.warn({ ...context, err: error }, 'uzatma defter kaydi yazilamadi; uzatma gecerli');
  }
}
