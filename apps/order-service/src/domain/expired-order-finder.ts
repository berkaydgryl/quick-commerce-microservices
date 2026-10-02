/**
 * Kilidi dolmus siparisleri bulan OKUMA portu (T11.2 PR 2): supurucunun is
 * kuyrugu. Iki uygulamasi var (bellek, Mongo); ayni sozlesme testinden gecer.
 */

import type { Order } from './order.js';

export interface ExpiredOrderFinder {
  /**
   * Kilidi `now` itibariyla dolmus DRAFT ve AWAITING_PAYMENT siparisler
   * (stock-reservation.ts hasExpiredReservation), kilidi en once dolan once,
   * en fazla `limit` tane. Kilidi olmayan eski siparisler donmez.
   */
  findExpiredReservations(now: Date, limit: number): Promise<readonly Order[]>;
}
