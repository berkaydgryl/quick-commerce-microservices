/**
 * Servisin stok depolari: musaitlik (okuma) ve rezervasyon (yazma) AYNI
 * kaynaktan gelir. Karisik kaynak (bellekten okuyup Redis'e rezerve etmek)
 * rezervasyonun musaitlikte gorunmemesi demektir; bu yuzden ikisi birlikte
 * tasinir.
 */

import type { ReservationStore } from './reservation.js';
import type { StockCounterReader } from './stock.js';

export interface StockPorts {
  readonly counters: StockCounterReader;
  readonly reservations: ReservationStore;
}
