/**
 * Servisin stok depolari: musaitlik (okuma) ve rezervasyon (yazma) AYNI
 * kaynaktan gelir. Karisik kaynak (bellekten okuyup Redis'e rezerve etmek)
 * rezervasyonun musaitlikte gorunmemesi demektir; bu yuzden ikisi birlikte
 * tasinir.
 */

import type { ReservationStore } from './reservation.js';
import type { StockLedger } from './stock-ledger.js';
import type { CounterRecovery, StockCounterReader } from './stock.js';

export interface StockPorts {
  readonly counters: StockCounterReader;
  readonly reservations: ReservationStore;
  /** Stok defteri (T10.2): Mongo'da `stock_ledger`, MOCK'ta bellek (B16). */
  readonly ledger: StockLedger;
  /**
   * Sayac bulunamayinca: Redis bosalmissa sayaclari yeniden kurar (T10.1 PR 2,
   * ADR-17). Bellekte bosalma yoktur, hep false.
   */
  readonly recoverCounters: CounterRecovery;
}
