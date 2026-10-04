/**
 * Kurye bekleyen siparisleri bulan OKUMA portu (T13.1 PR 2): kurye atayan
 * iscinin is kuyrugu. Iki uygulamasi var (bellek, Mongo); ayni sozlesme
 * testinden gecer. Turun sirasini (#92) domain/courier-dispatch.ts courierQueue
 * kurar; iki okuma yalnizca adaylari getirir.
 */

import type { Order } from './order.js';

export interface AwaitingCourierFinder {
  /**
   * `now` itibariyla kurye istenecek siparisler (courier-dispatch.ts
   * isCourierDue): once odenmisler (PAID), sonra deneme ani en eski kuryesiz
   * PREPARING; esitlikte kimlik sirasi, en fazla `limit` tane.
   */
  findAwaitingCourier(now: Date, limit: number): Promise<readonly Order[]>;

  /**
   * Kuryesiz bekleyenler (courier-dispatch.ts isWaitingForCourier), deneme ani
   * gelmemis olsalar da: kuyruga `before`'dan ONCE girmisler (courierQueuedAt),
   * kuyruk sirasiyla (once odeyen once, esitlikte kimlik), en fazla `limit`.
   * Isci bunlari ayni turdaki yeni talepten once dener (#92).
   */
  findWaitingBefore(before: Date, limit: number): Promise<readonly Order[]>;
}
