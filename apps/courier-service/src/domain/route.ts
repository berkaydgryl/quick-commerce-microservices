/**
 * Siparisin kurye rotasi (T13.2): kuryenin atama anindaki konumu -> market
 * (paket alma) -> teslimat adresi. AssignCourier bir kez uretir ve saklar;
 * StartRoute ayni rotayi doner.
 *
 * T13.3: rota ZAMANLA ilerler (route-progress.ts); tick isci kilometre
 * taslarini (paket alindi, teslim edildi) BIR KEZ kaydeder ve olayini
 * yayinlar. Durum:
 *   MOVING : ilerliyor ya da teslimat olayi henuz yayinlanmadi (tick isler)
 *   DONE   : teslim edildi ve olayi yayinlandi (tick birakir)
 *   ENDED  : teslimattan once birakildi (siparis iptal, kurye yeniden atandi);
 *            ilerlemez, takip NOT_FOUND
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
  /** Paketin alinacagi market (T13.3); T13.3 oncesi rotada yok. */
  readonly marketId?: string;
  /** Ilerleme durumu (T13.3); yoksa MOVING (T13.3 oncesi rota). */
  readonly state?: RouteState;
  /** Paketin alindigi an, kaydedildiyse. */
  readonly pickedUpAt?: Date;
  /** courier.picked_up yayinlandi mi. */
  readonly pickupPublished?: boolean;
  /** Teslim ani, kaydedildiyse. */
  readonly deliveredAt?: Date;
  /** courier.delivered yayinlandi mi; true ise durum DONE. */
  readonly deliveryPublished?: boolean;
  /** Teslimattan once birakildigi an (durum ENDED). */
  readonly endedAt?: Date;
}

export const ROUTE_STATE = {
  MOVING: 'MOVING',
  DONE: 'DONE',
  ENDED: 'ENDED',
} as const;

export type RouteState = (typeof ROUTE_STATE)[keyof typeof ROUTE_STATE];

/** Tick'in kaydettigi alanlar: kosullu guncellemenin yamasi. */
export type RoutePatch = Partial<
  Pick<
    Route,
    'state' | 'pickedUpAt' | 'pickupPublished' | 'deliveredAt' | 'deliveryPublished' | 'endedAt'
  >
>;

/** Rotanin ilerleme durumu; T13.3 oncesi rotada alan yoktur ve MOVING sayilir. */
export function routeState(route: Pick<Route, 'state'>): RouteState {
  return route.state ?? ROUTE_STATE.MOVING;
}
