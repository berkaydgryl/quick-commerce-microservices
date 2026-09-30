/**
 * Bellekteki stok defteri (MOCK=true, B16: Mongo yok, defter Mongo'ya
 * yazilmaz). Ayni kurallar: ayni kayit (siparis x sku x tur) ikinci kez
 * yazilmaz; siparisin sonucu buradan okunur. Surec kapaninca kaybolur.
 */

import type { ReservationSettlement } from '../../domain/reservation.js';
import { ledgerEntryId, settlementOfKind } from '../../domain/stock-ledger.js';
import type { LedgerEntry, StockLedger } from '../../domain/stock-ledger.js';

export class InMemoryStockLedger implements StockLedger {
  private readonly entries = new Map<string, LedgerEntry>();

  record(entries: readonly LedgerEntry[]): Promise<void> {
    for (const entry of entries) {
      const key = ledgerEntryId(entry);
      if (!this.entries.has(key)) {
        this.entries.set(key, entry);
      }
    }
    return Promise.resolve();
  }

  settlementOf(marketId: string, orderId: string): Promise<ReservationSettlement | undefined> {
    for (const entry of this.entries.values()) {
      if (entry.marketId === marketId && entry.orderId === orderId) {
        const settlement = settlementOfKind(entry.kind);
        if (settlement !== undefined) {
          return Promise.resolve(settlement);
        }
      }
    }
    return Promise.resolve(undefined);
  }

  /** Yazilan kayitlar (testler icin; yazim sirasinda). */
  all(): readonly LedgerEntry[] {
    return [...this.entries.values()];
  }
}
