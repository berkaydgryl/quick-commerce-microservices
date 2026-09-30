/**
 * Bellekteki stok (MOCK=true, B16): sayaclar ve rezervasyonlar AYNI haritayi
 * paylasir; rezervasyonun dusumu musaitlik sorgusunda hemen gorunur (Redis'te
 * ayni anahtarlar gibi). Defter de bellektedir (Mongo yok).
 */

import {
  RESERVATION_HOLD_AFTER_EXPIRY_MS,
  SETTLED_RESERVATION_TTL_MS,
} from '../../config/constants.js';
import type { StockLevel } from '../../domain/stock.js';

import { InMemoryReservationStore } from './in-memory-reservation-store.js';
import { InMemoryStockCounters } from './in-memory-stock-counters.js';
import { InMemoryStockLedger } from './in-memory-stock-ledger.js';

export interface InMemoryStock {
  readonly counters: InMemoryStockCounters;
  readonly reservations: InMemoryReservationStore;
  readonly ledger: InMemoryStockLedger;
  /** Bellek bosalmaz: bulunamayan sayac gercekten yoktur. */
  readonly recoverCounters: () => Promise<boolean>;
}

export function createInMemoryStock(levels: readonly StockLevel[]): InMemoryStock {
  const shared = new Map<string, number>();
  return {
    counters: new InMemoryStockCounters(levels, shared),
    reservations: new InMemoryReservationStore(shared, {
      holdAfterExpiryMs: RESERVATION_HOLD_AFTER_EXPIRY_MS,
      settledTtlMs: SETTLED_RESERVATION_TTL_MS,
    }),
    ledger: new InMemoryStockLedger(),
    recoverCounters: () => Promise.resolve(false),
  };
}
