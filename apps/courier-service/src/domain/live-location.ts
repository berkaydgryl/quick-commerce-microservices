/**
 * Kuryenin canli konumu (T13.3, asama 1): tick her turda ilerleyen kuryenin
 * hesaplanan konumunu kisa omurlu yazar (Redis courier:{courierId}:last). Konum
 * her tick'te Mongo'ya YAZILMAZ (roadmap T14.1 denetimi). Bugun okuyan yok:
 * yayini asama 2'de (courier.location). Paket alinmadan once bu konum ONCEKI
 * musterinin kapisindan baslar; hicbir uca gizlilik kurali olmadan verilmez
 * (bkz. tracking-view.ts). Kisisel veri sayilir: gunluge yazilmaz.
 */

import type { GeoPoint } from './courier.js';

export interface LiveLocation {
  readonly location: GeoPoint;
  readonly at: Date;
}

export interface LiveLocationStore {
  save(courierId: string, live: LiveLocation): Promise<void>;
  /** Suresi dolmamis son konum; yoksa null. */
  find(courierId: string): Promise<LiveLocation | null>;
}
