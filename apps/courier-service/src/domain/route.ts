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

import type { Courier, GeoPoint } from './courier.js';

/**
 * Rotanin hareket kurali (#197): uretildigi andaki kurye hizi ve markette
 * hazirlik suresi (config COURIER_SPEED_KMH, ORDER_PREP_SECONDS).
 */
export interface RouteMovement {
  readonly speedKmh: number;
  /** Siparisin markette hazirlanma suresi, saniye: kurye erken varirsa bekler. */
  readonly prepSeconds: number;
}

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
  /**
   * Uretildigi andaki hareket kurali (#197). Ayar sonradan degisse de rota
   * bununla ilerler: gecmis anlar kaymaz, alma ve teslim ayni turda yazilmaz.
   * #197 oncesi rotada yok: o anki ayar kullanilir (goc yok).
   */
  readonly movement?: RouteMovement;
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

/**
 * Teslim ani alma anindan ONCE olamaz (#190): olursa teslim = alma. Tick
 * (yazarken) ve takip (gosterirken) ayni kurali kullanir. #195'ten beri ikinci
 * bacak kayitli almadan hesaplanir; bu kural savunmadir (kayit disi kaynak).
 */
export function deliveredNoEarlierThan(deliveredAt: Date, pickedUpAt: Date | undefined): Date {
  return pickedUpAt !== undefined && pickedUpAt.getTime() > deliveredAt.getTime()
    ? pickedUpAt
    : deliveredAt;
}

/** Teslim kaydedildi mi (an yazildi ya da rota DONE). Tick, iptal ve takip ayni kurali kullanir. */
export function isDelivered(route: Pick<Route, 'deliveredAt' | 'state'>): boolean {
  return route.deliveredAt !== undefined || routeState(route) === ROUTE_STATE.DONE;
}

/**
 * Yeniden okunan rota, ilk okunanin AYNISI (kurye + uretilme ani), birakilmamis
 * ve teslimi bu arada kaydedilmis mi? Takip (teslim ani yarisi) ve iptal
 * (#177) ayni kurali kullanir.
 */
export function deliveredMeanwhile(
  first: Pick<Route, 'courierId' | 'createdAt'>,
  again: Route | null,
): again is Route {
  return (
    again !== null &&
    sameRoute(again, first) &&
    routeState(again) !== ROUTE_STATE.ENDED &&
    isDelivered(again)
  );
}

/** Ayni rota mi: siparis basina tek belge; kimlik kurye + uretilme ani (yeniden atamada yenilenir). */
export function sameRoute(
  left: Pick<Route, 'courierId' | 'createdAt'>,
  right: Pick<Route, 'courierId' | 'createdAt'>,
): boolean {
  return (
    left.courierId === right.courierId && left.createdAt.getTime() === right.createdAt.getTime()
  );
}

/**
 * Rota bu kuryenin SON atamasinin mi: kurye ayni siparisi yeniden aldiysa eski
 * rota, yenisi yazilana kadar onun degildir (atama ani rotadan yeni).
 */
export function belongsToAssignment(
  route: Pick<Route, 'courierId' | 'createdAt'>,
  courier: Pick<Courier, 'id' | 'lastAssignedAt'>,
): boolean {
  if (route.courierId !== courier.id) {
    return false;
  }
  return (
    courier.lastAssignedAt === undefined ||
    route.createdAt.getTime() >= courier.lastAssignedAt.getTime()
  );
}
