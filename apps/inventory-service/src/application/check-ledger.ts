/**
 * Use-case: stok defterinin toplamini eldeki adetle karsilastirir (T10.2 PR 2;
 * roadmap B24: "reseed sonrasi ledger toplami ile onHand karsilastirilir, fark
 * raporlanir"). Bitti tanimi: her market x SKU icin defter toplami = onHand.
 *
 * Karar vermez, duzeltmez: farki dondurur; ne yapilacagi (inceleme, seed)
 * isletenin isidir. Kalici stok kacar kacar okunur (butun koleksiyon bellege
 * alinmaz); defter toplamlari tek toplama sorgusudur.
 */

import type { LedgerBalanceSource } from '../domain/stock-ledger.js';
import type { StockLevelSource } from '../domain/stock.js';

export interface CheckLedgerDeps {
  readonly levels: StockLevelSource;
  readonly ledger: LedgerBalanceSource;
  readonly batchSize: number;
}

/** Tutmayan bir market x SKU. Defterde hic kaydi yoksa `ledger` 0'dir. */
export interface LedgerMismatch {
  readonly marketId: string;
  readonly sku: string;
  /** Stok kaydi yoksa (yalnizca defterde var) undefined. */
  readonly onHand: number | undefined;
  readonly ledger: number;
}

export interface CheckLedgerResult {
  /** Karsilastirilan stok kaydi sayisi. */
  readonly checked: number;
  readonly mismatches: readonly LedgerMismatch[];
}

export type CheckLedger = () => Promise<CheckLedgerResult>;

export function createCheckLedger(deps: CheckLedgerDeps): CheckLedger {
  return async () => {
    const totals = new Map<string, number>();
    for (const balance of await deps.ledger.balances()) {
      totals.set(keyOf(balance.marketId, balance.sku), balance.total);
    }

    let checked = 0;
    const mismatches: LedgerMismatch[] = [];
    for await (const batch of deps.levels.batches(deps.batchSize)) {
      for (const { marketId, sku, onHand } of batch) {
        checked += 1;
        const key = keyOf(marketId, sku);
        const ledger = totals.get(key) ?? 0;
        totals.delete(key);
        if (ledger !== onHand) {
          mismatches.push({ marketId, sku, onHand, ledger });
        }
      }
    }
    // Defterde olup stokta olmayan market x SKU da tutmuyordur.
    for (const [key, ledger] of totals) {
      const [marketId = '', sku = ''] = key.split('/');
      mismatches.push({ marketId, sku, onHand: undefined, ledger });
    }
    return { checked, mismatches };
  };
}

function keyOf(marketId: string, sku: string): string {
  return `${marketId}/${sku}`;
}
