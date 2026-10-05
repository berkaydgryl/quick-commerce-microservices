/**
 * Siparisin kurye rotasi (T13.2): kuryenin atama anindaki konumu -> market
 * (paket alma) -> teslimat adresi. AssignCourier bir kez uretir ve saklar;
 * StartRoute ayni rotayi doner. Canli konum ve kalan sure T13.3'te.
 */

import type { GeoPoint } from './courier.js';

export interface Route {
  /** Rota siparis basina tektir: kimligi siparisin kimligi. */
  readonly orderId: string;
  /** Rotayi yuruyen kurye. */
  readonly courierId: string;
  /**
   * Esit aralikli noktalar (20-40): ilki kuryenin konumu, `pickupIndex`'teki
   * market (birebir), sonuncusu teslimat adresi.
   */
  readonly points: readonly GeoPoint[];
  /** Market noktasinin sirasi; kurye marketteyse 0. */
  readonly pickupIndex: number;
  /** Toplam yol, metre (tam sayi). */
  readonly distanceMeters: number;
  /** Ilk varis tahmini, saniye (tam sayi, yukari yuvarlanir). */
  readonly etaSeconds: number;
  /** Rotanin uretildigi an (atama). StartRoute'un "baslama ani". */
  readonly createdAt: Date;
}
