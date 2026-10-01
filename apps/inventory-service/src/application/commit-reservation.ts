/**
 * Use-case: rezervasyonu ONAYLAR; ayrilan adet kalici duser (T10.2 PR 2;
 * ADR-18, B3, B4). Odeme onaylandiktan sonra order cagirir (T11.2).
 *
 * Sira bilinclidir: once Redis'te sahiplik (commit.lua, ZREM), sonra Mongo'da
 * TEK transaction'da defter kaydi (-adet) ve eldeki adedin dusumu, en son iz
 * silinir. Mongo yazilamazsa hata doner; kaydin izi Redis'te kalir ve ayni
 * istegin tekrari onayi tamamlar ("zaten uygulandi"). Stok sayaclarina
 * dokunulmaz: adet rezervasyonda zaten dusulmustu.
 *
 * Sonuclar (inventory.proto ReservationOutcome):
 *  - applied: sahiplik bu cagrinin, onay yazildi.
 *  - already-applied: onay daha once yapilmisti; adet tekrar dusmedi.
 *  - not-found: onaylanacak rezervasyon yok (hic olmamis, birakilmis ya da
 *    suresi dolup geri alinmis). Order iade eder (B20).
 *
 * Eldeki adet eksiye duserse onay YINE yapilir (odeme alinmis, 1 Ekim karari
 * (a)) ve uyari yazilir: fazla satis izi gizlenmez, defterde gorunur.
 */

import type { Clock, Logger } from '@getir/core';

import type { ReservationLine, ReservationStore } from '../domain/reservation.js';
import { commitEntries } from '../domain/stock-ledger.js';
import type { StockCommitter, StockLedger } from '../domain/stock-ledger.js';
import type { ReservationResult } from './reservation-result.js';

export interface CommitReservationDeps {
  readonly reservations: Pick<ReservationStore, 'commit' | 'forgetSettled'>;
  readonly committer: StockCommitter;
  readonly ledger: Pick<StockLedger, 'settlementOf'>;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface CommitReservationInput {
  readonly orderId: string;
  readonly marketId: string;
}

export type CommitReservation = (input: CommitReservationInput) => Promise<ReservationResult>;

export function createCommitReservation(deps: CommitReservationDeps): CommitReservation {
  /** Defter + eldeki adet (tek transaction), sonra iz silinir. */
  const settle = async (
    input: CommitReservationInput,
    lines: readonly ReservationLine[],
    at: Date,
  ): Promise<void> => {
    const { negative } = await deps.committer.commit(commitEntries({ ...input, lines, at }));
    for (const { sku, onHand } of negative) {
      deps.logger.warn(
        { marketId: input.marketId, orderId: input.orderId, sku, onHand },
        'onay: eldeki adet eksiye dustu (fazla satis izi)',
      );
    }
    await deps.reservations.forgetSettled(input.marketId, input.orderId);
  };

  /** Ne aktif rezervasyon ne iz var: sonucu defter soyler. */
  const fromLedger = async (input: CommitReservationInput): Promise<ReservationResult> => {
    const settlement = await deps.ledger.settlementOf(input.marketId, input.orderId);
    return { outcome: settlement === 'committed' ? 'already-applied' : 'not-found' };
  };

  return async (input) => {
    const { orderId, marketId } = input;
    const nowMs = deps.clock.now();
    const outcome = await deps.reservations.commit({ orderId, marketId, nowMs });

    switch (outcome.status) {
      case 'committed':
        await settle(input, outcome.lines, new Date(nowMs));
        return { outcome: 'applied' };
      case 'settled':
        // Birakilmis rezervasyon onaylanamaz; izine de dokunulmaz (birakmanin
        // kendi tekrari tamamlar). Onaylanmissa yarida kalan yazim onceki anla
        // tamamlanir (tekrar yazim zararsiz, B14).
        if (outcome.settlement !== 'committed') {
          return { outcome: 'not-found' };
        }
        await settle(input, outcome.lines, new Date(outcome.settledAt));
        return { outcome: 'already-applied' };
      case 'orphaned':
        deps.logger.warn(
          { marketId, orderId },
          'onay: indeksteki rezervasyonun kaydi yok; onaylanamadi',
        );
        return fromLedger(input);
      case 'absent':
        return fromLedger(input);
    }
  };
}
