/**
 * Kurye bekleyen siparisleri bulan OKUMA portu (T13.1 PR 2): kurye atayan
 * iscinin is kuyrugu. Iki uygulamasi var (bellek, Mongo); ayni sozlesme
 * testinden gecer.
 */

import type { Order } from './order.js';

export interface AwaitingCourierFinder {
  /**
   * `now` itibariyla kurye istenecek siparisler (courier-dispatch.ts
   * isCourierDue): once odenmisler (PAID), sonra deneme ani en eski kuryesiz
   * PREPARING; esitlikte kimlik sirasi, en fazla `limit` tane.
   */
  findAwaitingCourier(now: Date, limit: number): Promise<readonly Order[]>;
}
