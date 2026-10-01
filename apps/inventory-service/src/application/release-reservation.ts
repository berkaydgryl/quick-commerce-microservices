/**
 * Use-case: rezervasyonu birakir, adetleri sayaclara geri verir ve stok
 * defterine yazar (T10.2; ADR-18, B3, B4).
 *
 * Sira bilinclidir: once Redis'te sahiplik (release.lua, ZREM), sonra Mongo'da
 * defter. Sahiplik onde olmali: supurucu ayni rezervasyonu ayni anda birakirsa
 * stok iki kez geri eklenmesin. Defter yazilamazsa (Mongo erisilemez) hata
 * doner ama sayaclar ZATEN geri eklenmistir; kaydin izi Redis'te kalir ve
 * tekrar gelen ayni istek defteri tamamlar ("zaten uygulandi"). Iz, defter
 * yazildiktan SONRA silinir.
 *
 * Sonuclar (inventory.proto ReservationOutcome):
 *  - applied: sahiplik bu cagrinin, sayaclar geri artti.
 *  - already-applied: birakma daha once yapilmisti ya da supurucu suresi dolani
 *    geri vermisti (T10.3); sayaclar tekrar artmadi.
 *  - not-found: birakilacak rezervasyon yok (hic olmamis ya da onaylanmis;
 *    onaylanan stok geri verilmez). Hata degil; cagiran sonuca gore dallanir.
 */

import type { Clock, Logger } from '@getir/core';

import type { ReservationStore, ReservationSettlement } from '../domain/reservation.js';
import { expireEntries, releaseEntries } from '../domain/stock-ledger.js';
import type { LedgerEntry, StockLedger } from '../domain/stock-ledger.js';
import type { ReservationResult } from './reservation-result.js';

export interface ReleaseReservationDeps {
  readonly reservations: Pick<ReservationStore, 'release' | 'forgetSettled'>;
  readonly ledger: StockLedger;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface ReleaseReservationInput {
  readonly orderId: string;
  readonly marketId: string;
  /** Kisa anahtar (istek semasi dogrular); defter kaydina oldugu gibi yazilir. */
  readonly reason: string;
}

export type ReleaseReservation = (input: ReleaseReservationInput) => Promise<ReservationResult>;

export function createReleaseReservation(deps: ReleaseReservationDeps): ReleaseReservation {
  /** Defteri yazar, sonra izi siler: sira tersine donerse iz defterden once kaybolurdu. */
  const settle = async (
    input: ReleaseReservationInput,
    entries: readonly LedgerEntry[],
  ): Promise<void> => {
    await deps.ledger.record(entries);
    await deps.reservations.forgetSettled(input.marketId, input.orderId);
  };

  /** Ne aktif rezervasyon ne iz var: sonucu defter soyler. */
  const fromLedger = async (input: ReleaseReservationInput): Promise<ReservationResult> => {
    const settlement = await deps.ledger.settlementOf(input.marketId, input.orderId);
    return { outcome: stockReturned(settlement) ? 'already-applied' : 'not-found' };
  };

  return async (input) => {
    const { orderId, marketId, reason } = input;
    const nowMs = deps.clock.now();
    const outcome = await deps.reservations.release({ orderId, marketId, reason, nowMs });

    switch (outcome.status) {
      case 'released':
        if (outcome.skippedCounters > 0) {
          deps.logger.warn(
            { marketId, orderId, skipped: outcome.skippedCounters },
            'birakma: sayaci olmayan kalem geri eklenmedi',
          );
        }
        await settle(
          input,
          releaseEntries({ ...input, lines: outcome.lines, at: new Date(nowMs) }),
        );
        return { outcome: 'applied' };
      case 'settled': {
        // Onaylanmis rezervasyon birakilamaz; izine de dokunulmaz (onayin kendi
        // tekrari tamamlar). Birakilmis ya da suresi dolmussa stok zaten dondu:
        // onceki cagrinin (ya da supurucunun) defteri yarida kalmis olabilir,
        // onun gerekcesi ve aniyla tamamlanir (B14).
        if (!stockReturned(outcome.settlement)) {
          return { outcome: 'not-found' };
        }
        const settled = {
          orderId,
          marketId,
          lines: outcome.lines,
          at: new Date(outcome.settledAt),
        };
        await settle(
          input,
          outcome.settlement === 'expired'
            ? expireEntries(settled)
            : releaseEntries({ ...settled, reason: outcome.reason }),
        );
        return { outcome: 'already-applied' };
      }
      case 'orphaned':
        deps.logger.warn(
          { marketId, orderId },
          'birakma: indeksteki rezervasyonun kaydi yok; stok geri verilemedi',
        );
        return fromLedger(input);
      case 'absent':
        return fromLedger(input);
    }
  };
}

/** Stok sayaca dondu mu: birakildi ya da suresi doldu (onaylanan donmez). */
function stockReturned(settlement: ReservationSettlement | undefined): boolean {
  return settlement === 'released' || settlement === 'expired';
}
